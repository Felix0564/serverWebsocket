const WebSocket = require('ws');

const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Ajout pour UUID

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8080;
const protocol= require('./protocol');

app.get('/', (req, res) => {
  res.send('Serveur de chat en temps réel avec support de salles de discussion');
});

const wss = new WebSocket.Server({ server });

// Stocker les clients par room
const roomClients = new Map();

// Historique des messages par room
const roomMessageHistories = new Map();
const MAX_HISTORY_SIZE = 100;

// Classe représentant une salle de discussion - Mise à jour selon les nouvelles spécifications
class ChatRoom {
  constructor(keyName, participants) {
    // KeyName est désormais Userid+userMobile+UUID+DateTime
    this.keyName = keyName;
    
    // Label est User1.Name+User2.Name+...+UserN.Name
    this.label = participants.map(p => p.name).join('+');
    
    this.description = '';
    this.urlImage = '';
    this.participantsCount = participants.length;
    this.participantsInfos = participants;
    this.dateOpen = new Date();
    this.dateClose = null;
    
    // Structure ChatRoomInfos mise à jour
    this.chatRoomInfos = {
      socketServerUrl: `ws://${process.env.HOST || 'localhost'}:${PORT}`,
      historique: {
        total: 0,
        messages: []
      }
    };
  }

  addParticipant(participant) {
    this.participantsInfos.push(participant);
    this.participantsCount++;
    // Mise à jour du label
    this.label = this.participantsInfos.map(p => p.name).join('+');
  }

  removeParticipant(participantId) {
    this.participantsInfos = this.participantsInfos.filter(p => p.id !== participantId);
    this.participantsCount--;
    // Mise à jour du label
    this.label = this.participantsInfos.map(p => p.name).join('+');
  }
  
  // Vérifier si un participant a accès à la room par son mobile
  hasAccess(mobile) {
    if (!mobile) {
      return false;
    }
    
    // Ajoutons un log pour déboguer
    console.log(`Vérification d'accès pour mobile ${mobile} à la room ${this.keyName}`);
    console.log(`Participants: ${JSON.stringify(this.participantsInfos.map(p => p.mobile))}`);
    
    const hasAccess = this.participantsInfos.some(p => p.mobile === mobile);
    console.log(`Résultat: ${hasAccess}`);
    return hasAccess;
  }
  
  // Ajouter un message à l'historique de la room
  addMessage(username, message) {
    this.chatRoomInfos.historique.total++;
    this.chatRoomInfos.historique.messages.push({
      participant: username,
      message: message
    });
  }
}

// Classe représentant un participant
class Participant {
  constructor(id, name, mobile, urlImage) {
    this.id = id;
    this.name = name;
    this.mobile = mobile;
    this.urlImage = urlImage;
  }
}

// Fonction pour générer un KeyName 
function generateKeyName(userId, userMobile) {
  const uuid = uuidv4();
  const dateTime = new Date().toISOString().replace(/[-:\.]/g, '');
  return `${userId}+${userMobile}+${uuid}+${dateTime}`;
}

// Map pour stocker les rooms par keyName
const roomsByKeyName = new Map();

// Map pour stocker les associations mobile -> rooms
const mobileToRooms = new Map();

// Charger l'historique des messages pour une room
function loadRoomMessageHistory(roomId) {
  const historyFilePath = path.join(__dirname, `message_history_${roomId}.json`);
  try {
    if (fs.existsSync(historyFilePath)) {
      const data = fs.readFileSync(historyFilePath, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error(`Erreur lors du chargement de l'historique pour la room ${roomId}:`, error);
    return [];
  }
}

// Sauvegarder l'historique des messages pour une room
function saveRoomMessageHistory(roomId, messages) {
  const historyFilePath = path.join(__dirname, `message_history_${roomId}.json`);
  try {
    // Vérifier si le répertoire existe
    const dir = path.dirname(historyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Convertir les messages en JSON et les écrire dans le fichier
    const jsonData = JSON.stringify(messages, null, 2);
    fs.writeFileSync(historyFilePath, jsonData, 'utf8');
    console.log(`Historique sauvegardé pour la room ${roomId}: ${messages.length} messages`);
  } catch (error) {
    console.error(`Erreur lors de la sauvegarde de l'historique pour la room ${roomId}:`, error);
  }
}

// Ajouter un message à l'historique d'une room
function addToRoomHistory(roomId, message) {
  if (!roomMessageHistories.has(roomId)) {
    roomMessageHistories.set(roomId, []);
  }
  
  const roomHistory = roomMessageHistories.get(roomId);
  roomHistory.push(message);
  
  // Limiter la taille de l'historique
  if (roomHistory.length > MAX_HISTORY_SIZE) {
    roomHistory.shift(); // Supprimer le plus ancien message
  }
  
  // Mettre à jour l'historique dans l'objet ChatRoom
  const room = roomsByKeyName.get(roomId);
  if (room && message.type === 'message') {
    room.addMessage(message.username, message.message);
  }
  
  // Sauvegarder l'historique
  console.log(`Tentative de sauvegarde de l'historique pour la room ${roomId}`);
  try {
    saveRoomMessageHistory(roomId, roomHistory);
  } catch (error) {
    console.error(`Erreur lors de la sauvegarde de l'historique: ${error.message}`);
  }
}

// Fonction pour générer un ID utilisateur unique
function generateUserId() {
  return uuidv4();
}

// Gérer les connexions WebSocket
wss.on('connection', (ws) => {
  console.log('Nouveau client connecté');
  
  // Attribuer un ID unique à chaque client
  const clientId = generateUniqueId();
  let username = 'Anonyme';
  let roomId = null;
  let userMobile = null;
  
  // Stocker la connexion client
  const clientInfo = { ws, clientId, username, roomId, userMobile };
  
  // Gérer les messages du client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Message recu :", data);
      const timestamp = data.timestamp || new Date().toISOString();
      
      // Valider le message selon le protocole
      const validation = protocol.validateMessage(data);
      if (!validation.isValid) {
        console.log('Validation échouée:', validation);
        ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
          code: validation.code,
          message: validation.error
        })));
        return;
      }

      switch (data.type) {
        case protocol.USER.CONNECT.type:
          // Gérer la connexion d'un utilisateur uniquement par son mobile
          userMobile = data.mobile;
          
          if (!userMobile) {
            ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
              code: protocol.ERRORS.INVALID_MOBILE,
              message: 'Mobile est requis pour la connexion'
            })));
            return;
          }
          
          username = data.username || 'Anonyme';
          
          // Générer un ID utilisateur unique
          const userId = generateUserId();
          
          // Mettre à jour les informations du client
          clientInfo.username = username;
          clientInfo.userMobile = userMobile;
          clientInfo.userId = userId;
          
          console.log(`Utilisateur ${username} (mobile: ${userMobile}, id: ${userId}) connecté`);
          
          // Créer un ensemble vide pour stocker les clients non associés à une room
          if (!roomClients.has('unassigned')) {
            roomClients.set('unassigned', new Set());
          }
          
          // Ajouter le client à l'ensemble des clients non assignés
          roomClients.get('unassigned').add(clientInfo);
          
          // Vérifier si l'utilisateur a des rooms associées à son mobile
          if (mobileToRooms.has(userMobile)) {
            const roomIds = Array.from(mobileToRooms.get(userMobile));
            console.log(`Salles trouvées pour le mobile ${userMobile}:`, roomIds);
            
            const accessibleRooms = [];
            
            roomIds.forEach(roomId => {
              const room = roomsByKeyName.get(roomId);
              if (room) {
                console.log(`Salle ${roomId} trouvée pour le mobile ${userMobile}`);
                accessibleRooms.push({
                  keyName: room.keyName,
                  label: room.label,
                  description: room.description,
                  urlImage: room.urlImage,
                  participantsCount: room.participantsCount,
                  participantsInfos: room.participantsInfos,
                  dateOpen: room.dateOpen,
                  chatRoomInfos: room.chatRoomInfos
                });
              } else {
                console.log(`Salle ${roomId} non trouvée bien qu'associée au mobile ${userMobile}`);
              }
            });
            
            // Envoyer la liste des rooms accessibles à l'utilisateur
            if (accessibleRooms.length > 0) {
              console.log(`Envoi de ${accessibleRooms.length} salles à l'utilisateur ${username} (mobile: ${userMobile})`);
              ws.send(JSON.stringify(protocol.createSystemMessage('ROOMS_LIST', {
                rooms: accessibleRooms
              })));
            } else {
              console.log(`Aucune salle accessible trouvée pour l'utilisateur ${username} (mobile: ${userMobile})`);
            }
          } else {
            console.log(`Aucune salle associée au mobile ${userMobile}`);
          }
          
          // Envoyer une confirmation de connexion avec l'ID utilisateur
          ws.send(JSON.stringify(protocol.createSystemMessage('NOTIFICATION', {
            message: `Bienvenue, ${username}!`,
            userId: userId
          })));
          break;
        
        case protocol.USER.CREATE_ROOM.type:
          // Créer une nouvelle salle de discussion
          userMobile = data.mobile;
          
          if (!userMobile) {
            ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
              code: protocol.ERRORS.INVALID_MESSAGE,
              message: 'Mobile est requis'
            })));
            return;
          }
          
          // Utiliser l'ID utilisateur stocké dans clientInfo, ignorer celui du message
          const creatorUserId = clientInfo.userId || generateUserId();
          
          // Créer la liste des participants
          const participants = data.participants || [];
          if (!participants.some(p => p.mobile === userMobile)) {
            // Ajouter le créateur comme participant s'il n'y est pas déjà
            participants.push(new Participant(
              creatorUserId,
              data.username || clientInfo.username || 'Anonyme',
              userMobile,
              data.urlImage || ''
            ));
          }
          
          // Générer le KeyName selon le format spécifié
          roomId = generateKeyName(creatorUserId, userMobile);
          
          // Créer la nouvelle room
          const newRoom = new ChatRoom(roomId, participants);
          roomsByKeyName.set(roomId, newRoom);
          
          // Associer chaque mobile des participants à cette room
          participants.forEach(participant => {
            const participantMobile = participant.mobile;
            if (!participantMobile) {
              console.log(`Mobile manquant pour un participant, ignoré`);
              return;
            }
            
            if (!mobileToRooms.has(participantMobile)) {
              mobileToRooms.set(participantMobile, new Set());
            }
            mobileToRooms.get(participantMobile).add(roomId);
            console.log(`Associé mobile ${participantMobile} à la room ${roomId}`);
          });
          
          // Stocker la room pour les clients
          roomClients.set(roomId, new Set());
          
          // Notifier tous les participants concernés de la création de la room
          broadcastRoomCreation(newRoom);
          
          // Répondre au client avec plus d'informations sur la room
          ws.send(JSON.stringify(protocol.createSystemMessage('ROOM_CREATED', {
            roomId: roomId,
            room: {
              keyName: newRoom.keyName,
              label: newRoom.label,
              description: newRoom.description,
              urlImage: newRoom.urlImage,
              participantsCount: newRoom.participantsCount,
              dateOpen: newRoom.dateOpen,
              chatRoomInfos: newRoom.chatRoomInfos
            }
          })));
          break;
        
        case protocol.USER.JOIN_ROOM.type:
          // Rejoindre une salle de discussion existante
          roomId = data.roomId;
          username = data.username || 'Anonyme';
          userMobile = data.mobile || '';
          
          console.log(`Tentative de rejoindre la salle ${roomId} par ${username} (mobile: ${userMobile})`);
          
          try {
            // Vérifier si la room existe
            if (!roomsByKeyName.has(roomId)) {
              console.log(`Salle ${roomId} non trouvée`);
              ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
                code: protocol.ERRORS.ROOM_NOT_FOUND,
                message: 'Cette salle de discussion n\'existe pas'
              })));
              return;
            }
            
            // Vérifier si l'utilisateur a accès à cette room
            const room = roomsByKeyName.get(roomId);
            if (!userMobile || !room.hasAccess(userMobile)) {
              console.log(`Accès refusé à la salle ${roomId} pour le mobile ${userMobile}`);
              ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
                code: protocol.ERRORS.ACCESS_DENIED,
                message: 'Vous n\'avez pas accès à cette salle de discussion'
              })));
              return;
            }
            
            // Créer la room client si elle n'existe pas
            if (!roomClients.has(roomId)) {
              roomClients.set(roomId, new Set());
            }
            
            // Mettre à jour les infos client
            clientInfo.roomId = roomId;
            clientInfo.username = username;
            clientInfo.userMobile = userMobile;
            
            // Ajouter le client à la room
            roomClients.get(roomId).add(clientInfo);
            
            // Annoncer la connexion à la room
            const joinMessage = {
              type: 'system',
              roomId: roomId,
              username: 'Système',
              message: `${username} a rejoint le chat`,
              timestamp: new Date().toISOString()
            };
            
            // Utiliser JSON.stringify pour s'assurer que nous envoyons une chaîne
            broadcastToRoom(roomId, joinMessage);
            addToRoomHistory(roomId, joinMessage);
            
            // Envoyer l'historique des messages au client
            sendRoomMessageHistory(ws, roomId);
            
            console.log(`Utilisateur ${username} (mobile: ${userMobile}) a rejoint la room ${roomId}`);
          } catch (error) {
            console.error(`Erreur lors de la connexion à la salle ${roomId}:`, error);
            ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
              code: protocol.ERRORS.CONNECTION_ERROR,
              message: 'Erreur lors de la connexion à la salle: ' + error.message
            })));
          }
          break;
          
        case protocol.USER.MESSAGE.type:
          // Vérifier que la room est spécifiée
          if (!data.roomId) {
            console.error('Aucune room spécifiée pour le message');
            return;
          }
          
          // Vérifier si l'utilisateur a accès à cette room
          roomId = data.roomId;
          userMobile = data.mobile || clientInfo.userMobile;
          
          if (!roomsByKeyName.has(roomId)) {
            ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
              code: protocol.ERRORS.ROOM_NOT_FOUND,
              message: 'Cette salle de discussion n\'existe pas'
            })));
            return;
          }
          
          const messageRoom = roomsByKeyName.get(roomId);
          if (!messageRoom.hasAccess(userMobile)) {
            ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
              code: protocol.ERRORS.ACCESS_DENIED,
              message: 'Vous n\'avez pas accès à cette salle de discussion'
            })));
            return;
          }
          
          // Créer l'objet message
          const chatMessage = {
            type: 'message',
            roomId: data.roomId,
            username: data.username,
            message: data.message,
            timestamp
          };
          
          // Ajouter le message à l'historique de la room
          addToRoomHistory(data.roomId, chatMessage);
          
          // Diffuser le message uniquement aux membres de la room
          broadcastToRoom(data.roomId, chatMessage, clientId);
          
          console.log(`Message dans la room ${data.roomId} de ${data.username}: ${data.message}`);
          break;
        
        case protocol.USER.LEAVE_ROOM.type:
          // Quitter une salle de discussion
          if (roomId) {
            handleRoomLeave(clientId, roomId, username);
          }
          break;
          
        case protocol.USER.GET_ROOMS.type:
          userMobile = data.mobile;
          if (!userMobile) {
            ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
              code: protocol.ERRORS.INVALID_MOBILE,
              message: 'Mobile non spécifié'
            })));
            return;
          }
        
          // Récupérer les rooms accessibles pour ce mobile
          const accessibleRooms = [];
          if (mobileToRooms.has(userMobile)) {
            const roomIds = Array.from(mobileToRooms.get(userMobile));
            console.log(`GET_ROOMS: Salles trouvées pour le mobile ${userMobile}:`, roomIds);
            
            roomIds.forEach(roomId => {
              const room = roomsByKeyName.get(roomId);
              if (room) {
                // Vérifier explicitement l'accès
                if (room.hasAccess(userMobile)) {
                  accessibleRooms.push({
                    keyName: room.keyName,
                    label: room.label,
                    description: room.description,
                    urlImage: room.urlImage,
                    participantsCount: room.participantsCount,
                    participantsInfos: room.participantsInfos,
                    dateOpen: room.dateOpen,
                    chatRoomInfos: room.chatRoomInfos
                  });
                } else {
                  console.log(`GET_ROOMS: Le mobile ${userMobile} n'a pas accès à la salle ${roomId} bien qu'associé`);
                }
              } else {
                console.log(`GET_ROOMS: Salle ${roomId} non trouvée bien qu'associée au mobile ${userMobile}`);
              }
            });
          }
        
          // Envoyer la liste des rooms accessibles
          if (accessibleRooms.length > 0) {
            console.log(`GET_ROOMS: Envoi de ${accessibleRooms.length} salles à l'utilisateur avec mobile: ${userMobile}`);
          } else {
            console.log(`GET_ROOMS: Aucune salle accessible trouvée pour le mobile ${userMobile}`);
          }
          ws.send(JSON.stringify(protocol.createSystemMessage('ROOMS_LIST', {
            rooms: accessibleRooms
          })));
          break;
        
        case protocol.USER.ADD_PARTICIPANTS.type:
          // Ajouter des participants à une salle existante
          roomId = data.roomId;
          userMobile = data.mobile;
          
          console.log(`Tentative d'ajout de participants à la salle ${roomId} par l'utilisateur avec mobile ${userMobile}`);
          
          try {
            // Vérifier si la room existe
            if (!roomsByKeyName.has(roomId)) {
              console.log(`Salle ${roomId} non trouvée`);
              ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
                code: protocol.ERRORS.ROOM_NOT_FOUND,
                message: 'Cette salle de discussion n\'existe pas'
              })));
              return;
            }
            
            // Vérifier si l'utilisateur a accès à cette room
            const room = roomsByKeyName.get(roomId);
            if (!userMobile || !room.hasAccess(userMobile)) {
              console.log(`Accès refusé à la salle ${roomId} pour le mobile ${userMobile}`);
              ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
                code: protocol.ERRORS.ACCESS_DENIED,
                message: 'Vous n\'avez pas accès à cette salle de discussion'
              })));
              return;
            }
            
            // Récupérer les nouveaux participants
            const newParticipants = data.newParticipants || [];
            if (newParticipants.length === 0) {
              ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
                code: protocol.ERRORS.INVALID_MESSAGE,
                message: 'Aucun nouveau participant spécifié'
              })));
              return;
            }
            
            console.log(`Ajout de ${newParticipants.length} participants à la salle ${roomId}`);
            
            // Ajouter chaque nouveau participant à la room
            newParticipants.forEach(participant => {
              const participantMobile = participant.mobile;
              if (!participantMobile) {
                console.log(`Mobile manquant pour un participant, ignoré`);
                return;
              }
              
              // Vérifier si le participant est déjà dans la room
              if (room.hasAccess(participantMobile)) {
                console.log(`Le participant avec mobile ${participantMobile} est déjà dans la salle ${roomId}`);
                return;
              }
              
              // Créer un nouvel objet Participant
              const newParticipant = new Participant(
                generateUserId(),
                participant.name || `Utilisateur ${participantMobile}`,
                participantMobile,
                participant.urlImage || ''
              );
              
              // Ajouter le participant à la room
              room.addParticipant(newParticipant);
              
              // Associer le mobile du participant à cette room
              if (!mobileToRooms.has(participantMobile)) {
                mobileToRooms.set(participantMobile, new Set());
              }
              mobileToRooms.get(participantMobile).add(roomId);
              console.log(`Associé mobile ${participantMobile} à la room ${roomId}`);
            });
            
            // Annoncer l'ajout des participants
            const addParticipantsMessage = {
              type: 'system',
              roomId: roomId,
              username: 'Système',
              message: `${clientInfo.username} a ajouté ${newParticipants.length} participant(s) à la salle`,
              timestamp: new Date().toISOString()
            };
            
            broadcastToRoom(roomId, addParticipantsMessage);
            addToRoomHistory(roomId, addParticipantsMessage);
            
            // Notifier les nouveaux participants
            broadcastRoomCreation(room);
            
            // Répondre au client avec la room mise à jour
            ws.send(JSON.stringify(protocol.createSystemMessage('NOTIFICATION', {
              message: `${newParticipants.length} participant(s) ajouté(s) avec succès à la salle`,
              roomId: roomId
            })));
            
            console.log(`${newParticipants.length} participant(s) ajouté(s) à la salle ${roomId}`);
          } catch (error) {
            console.error(`Erreur lors de l'ajout de participants à la salle ${roomId}:`, error);
            ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
              code: protocol.ERRORS.CONNECTION_ERROR,
              message: 'Erreur lors de l\'ajout de participants: ' + error.message
            })));
          }
          break;
          
        default:
          ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
            code: protocol.ERRORS.INVALID_MESSAGE,
            message: 'Type de message inconnu'
          })));
      }
    } catch (error) {
      console.error('Erreur de traitement du message:', error);
      ws.send(JSON.stringify(protocol.createSystemMessage('ERROR', {
        code: protocol.ERRORS.CONNECTION_ERROR,
        message: 'Erreur de traitement du message'
      })));
    }
  });
  
  // Gérer la déconnexion
  ws.on('close', () => {
    if (roomId) {
      handleRoomLeave(clientId, roomId, username);
    }
  });
});

// Fonction pour gérer le départ d'une room
function handleRoomLeave(clientId, roomId, username) {
  const roomClientSet = roomClients.get(roomId);
  
  if (roomClientSet) {
    // Retirer le client de la room
    const clientToRemove = Array.from(roomClientSet).find(c => c.clientId === clientId);
    if (clientToRemove) {
      roomClientSet.delete(clientToRemove);
    }
    
    // Annoncer le départ
    const disconnectMessage = {
      type: 'system',
      roomId: roomId,
      username: 'Système',
      message: `${username} a quitté le chat`,
      timestamp: new Date().toISOString()
    };
    
    broadcastToRoom(roomId, disconnectMessage);
    addToRoomHistory(roomId, disconnectMessage);
    
    console.log(`Client ${username} a quitté la room ${roomId}`);
  }
}

// Fonction pour envoyer l'historique des messages d'une room à un client
function sendRoomMessageHistory(ws, roomId) {
  try {
    // Récupérer l'historique des messages
    let roomHistory = roomMessageHistories.get(roomId);
    
    // Si l'historique n'est pas en mémoire, essayer de le charger depuis le fichier
    if (!roomHistory) {
      try {
        roomHistory = loadRoomMessageHistory(roomId);
        // Stocker en mémoire pour les prochaines fois
        if (roomHistory && roomHistory.length > 0) {
          roomMessageHistories.set(roomId, roomHistory);
        }
      } catch (loadError) {
        console.error(`Erreur lors du chargement de l'historique pour la room ${roomId}:`, loadError);
        roomHistory = [];
      }
    }
    
    // S'assurer que roomHistory est un tableau
    if (!Array.isArray(roomHistory)) {
      roomHistory = [];
    }
    
    // Envoyer l'historique au client
    const historyPayload = {
      type: 'history',
      roomId: roomId,
      messages: roomHistory
    };
    
    ws.send(JSON.stringify(historyPayload));
    console.log(`Historique envoyé pour la room ${roomId}: ${roomHistory.length} messages`);
  } catch (error) {
    console.error(`Erreur lors de l'envoi de l'historique pour la room ${roomId}:`, error);
    // Ne pas propager l'erreur, juste la logger
  }
}

// Fonction pour générer un ID unique
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 10);
}

// Fonction pour diffuser un message à tous les clients d'une room
function broadcastToRoom(roomId, data, excludeClientId = null) {
  // Convertir l'objet en chaîne JSON
  const message = typeof data === 'string' ? data : JSON.stringify(data);
  
  const notification = protocol.createSystemMessage('MESSAGE_NOTIFICATION', {
    roomId: roomId,
    message: {
      username: data.username,
      preview: data.type === 'message' ? data.message.substring(0, 50) + '...' : data.message,
      timestamp: data.timestamp
    }
  });
  
  // Convertir la notification en chaîne JSON
  const notificationStr = JSON.stringify(notification);

  const room = roomsByKeyName.get(roomId);
  if (!room) return;

  // Parcourir toutes les rooms pour trouver les clients à notifier
  roomClients.forEach((clientSet, currentRoomId) => {
    clientSet.forEach(clientInfo => {
      if (clientInfo.ws.readyState === WebSocket.OPEN && 
          room.hasAccess(clientInfo.userMobile)) {
        
        // Si le client est dans la room actuelle, envoyer le message complet
        if (currentRoomId === roomId && clientInfo.clientId !== excludeClientId) {
          clientInfo.ws.send(message);
        } 
        // Si le client n'est pas dans la room mais a accès, envoyer la notification
        else if (currentRoomId !== roomId) {
          clientInfo.ws.send(notificationStr);
        }
      }
    });
  });
}

// Fonction pour notifier les participants d'une nouvelle room
function broadcastRoomCreation(room) {
  const notification = protocol.createSystemMessage('NEW_ROOM', {
    room: {
      keyName: room.keyName,
      label: room.label,
      description: room.description,
      urlImage: room.urlImage,
      participantsCount: room.participantsCount,
      participantsInfos: room.participantsInfos,
      dateOpen: room.dateOpen,
      chatRoomInfos: room.chatRoomInfos
    }
  });

  console.log(`Notification de création de salle: ${room.keyName}`);
  console.log(`Participants à notifier: ${JSON.stringify(room.participantsInfos.map(p => p.mobile))}`);

  // Parcourir tous les clients WebSocket connectés
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      // Chercher les informations du client
      let clientInfo = null;
      
      // Chercher dans toutes les rooms
      for (const clientSet of roomClients.values()) {
        for (const info of clientSet) {
          if (info.ws === client) {
            clientInfo = info;
            break;
          }
        }
        if (clientInfo) break;
      }
      
      // Si on a trouvé les infos client
      if (clientInfo && clientInfo.userMobile) {
        console.log(`Vérification d'accès pour le client ${clientInfo.username} (${clientInfo.userMobile})`);
        
        // Vérifier si le client a accès à la room
        if (room.hasAccess(clientInfo.userMobile)) {
          console.log(`Envoi de notification de nouvelle salle à ${clientInfo.username} (${clientInfo.userMobile})`);
          client.send(JSON.stringify(notification));
        } else {
          console.log(`Le client ${clientInfo.username} (${clientInfo.userMobile}) n'a pas accès à la salle`);
        }
      }
    }
  });
}

// Démarrer le serveur
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});

// Gestion de la fermeture propre du serveur
process.on('SIGINT', () => {
  console.log('Arrêt du serveur...');
  // Sauvegarder les historiques de toutes les rooms
  roomMessageHistories.forEach((history, roomId) => {
    saveRoomMessageHistory(roomId, history);
  });
  process.exit(0);
});

module.exports = { ChatRoom, Participant };

// Servir les fichiers statiques
app.use(express.static('public'));