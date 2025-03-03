// Fichier: server.js
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Initialiser l'application Express
const app = express();
const server = http.createServer(app);

// Configurer le port pour l'hébergement
const PORT = process.env.PORT || 8080;

// Page d'accueil simple
app.get('/', (req, res) => {
  res.send('Serveur de chat en temps réel actif');
});

// Initialiser le serveur WebSocket
const wss = new WebSocket.Server({ server });

// Liste des clients connectés
const clients = new Map();

// Stockage des messages (en mémoire)
const messageHistory = [];
const MAX_HISTORY_SIZE = 100; // Limiter pour éviter une consommation excessive de mémoire

// Fichier pour sauvegarder l'historique des messages
const HISTORY_FILE = path.join(__dirname, 'message_history.json');

// Charger l'historique des messages depuis le fichier
function loadMessageHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      messageHistory.push(...parsed);
      console.log(`Historique des messages chargé (${parsed.length} messages)`);
    }
  } catch (error) {
    console.error('Erreur lors du chargement de l\'historique des messages:', error);
  }
}

// Sauvegarder l'historique des messages dans un fichier
function saveMessageHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(messageHistory), 'utf8');
    console.log('Historique des messages sauvegardé');
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de l\'historique des messages:', error);
  }
}

// Charger l'historique au démarrage
loadMessageHistory();

// Gérer les connexions WebSocket
wss.on('connection', (ws) => {
  console.log('Nouveau client connecté');
  
  // Attribuer un ID unique à chaque client
  const clientId = generateUniqueId();
  let username = 'Anonyme';
  
  // Stocker la connexion client
  clients.set(clientId, {
    ws,
    username,
    isAlive: true
  });

  // Envoyer l'historique des messages au nouveau client
  if (messageHistory.length > 0) {
    ws.send(JSON.stringify({
      type: 'history',
      messages: messageHistory
    }));
  }

  // Ping pour maintenir la connexion active
  ws.on('pong', () => {
    const client = clients.get(clientId);
    if (client) {
      client.isAlive = true;
    }
  });

  // Gérer les messages du client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          // Mettre à jour le nom d'utilisateur
          username = data.username || 'Anonyme';
          clients.get(clientId).username = username;
          
          // Annoncer la connexion à tous les clients sauf l'expéditeur
          broadcastMessage({
            type: 'system',
            username: 'Système',
            message: `${username} a rejoint le chat`,
            timestamp: new Date().toISOString()
          }, clientId);
          
          console.log(`Utilisateur connecté: ${username}`);
          break;
          
        case 'message':
          // Créer l'objet message
          const messageObj = {
            type: 'message',
            username: data.username,
            message: data.message,
            timestamp: new Date().toISOString()
          };
          
          // Sauvegarder le message dans l'historique
          addToMessageHistory(messageObj);
          
          // Diffuser le message à tous les clients SAUF l'expéditeur
          broadcastMessage(messageObj, clientId);
          
          console.log(`Message de ${data.username}: ${data.message}`);
          break;
          
        default:
          console.log('Type de message inconnu:', data);
      }
    } catch (error) {
      console.error('Erreur de traitement du message:', error);
    }
  });

  // Gérer la déconnexion
  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client) {
      // Annoncer la déconnexion
      broadcastMessage({
        type: 'system',
        username: 'Système',
        message: `${client.username} a quitté le chat`,
        timestamp: new Date().toISOString()
      }, clientId);
      
      // Supprimer le client de la liste
      clients.delete(clientId);
      console.log(`Client déconnecté: ${client.username}`);
    }
  });
});

// Ajouter un message à l'historique
function addToMessageHistory(message) {
  messageHistory.push(message);
  
  // Limiter la taille de l'historique
  if (messageHistory.length > MAX_HISTORY_SIZE) {
    messageHistory.shift(); // Supprimer le message le plus ancien
  }
  
  // Sauvegarder l'historique périodiquement
  if (messageHistory.length % 10 === 0) {
    saveMessageHistory();
  }
}

// Fonction pour générer un ID unique
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 10);
}

// Fonction pour diffuser un message à tous les clients sauf l'expéditeur
function broadcastMessage(data, excludeClientId = null) {
  const message = JSON.stringify(data);
  
  clients.forEach((client, id) => {
    // Ne pas envoyer le message à l'expéditeur
    if (id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// Vérification périodique des connexions
const interval = setInterval(() => {
  clients.forEach((client, id) => {
    if (client.isAlive === false) {
      // Client non-répondant, fermer la connexion
      client.ws.terminate();
      clients.delete(id);
      console.log(`Connexion terminée pour le client ${client.username} (non-répondant)`);
      return;
    }
    
    // Marquer comme non-répondant jusqu'à réception d'un pong
    client.isAlive = false;
    client.ws.ping();
  });
}, 30000); // Vérifier toutes les 30 secondes

// Arrêter l'intervalle quand le serveur se ferme
wss.on('close', () => {
  clearInterval(interval);
  // Sauvegarder l'historique avant de fermer
  saveMessageHistory();
});

// Démarrer le serveur
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});

// Sauvegarder l'historique avant de fermer l'application
process.on('SIGINT', () => {
  console.log('Sauvegarde de l\'historique avant de quitter...');
  saveMessageHistory();
  process.exit();
});


////-------------------------///////////////////
// Fichier: server.js
//const WebSocket = require('ws');
//const http = require('http');
//const express = require('express');

// Initialiser l'application Express
//const app = express();
//const server = http.createServer(app);

// Configurer le port pour l'hébergement
//const PORT = process.env.PORT || 8080;

// Page d'accueil simple
//app.get('/', (req, res) => {
 // res.send('Serveur de chat en temps réel actif');
});

// Initialiser le serveur WebSocket
//const wss = new WebSocket.Server({ server });

// Liste des clients connectés
//const clients = new Map();

// Gérer les connexions WebSocket
//wss.on('connection', (ws) => {
 / console.log('Nouveau client connecté');

  // Attribuer un ID unique à chaque client
  //const clientId = generateUniqueId();
  //let username = 'Anonyme';

  // Stocker la connexion client
  //clients.set(clientId, {
    //ws,
    //username
  });

  // Gérer les messages du client
  //ws.on('message', (message) => {
   // try {
     // const data = JSON.parse(message);
      
      //switch (data.type) {
        //case 'join':
          // Mettre à jour le nom d'utilisateur
          //username = data.username || 'Anonyme';
          //clients.get(clientId).username = username;
          
          // Annoncer la connexion à tous les clients
          //broadcastMessage({
           // username: 'Système',
           // message: `${username} a rejoint le chat`,
          });
          
          //console.log(`Utilisateur connecté: ${username}`);
          //break;
          
        //case 'message':
          // Diffuser le message à tous les clients
         // broadcastMessage({
          //  username: data.username,
           // message: data.message,
          //});
          
          //console.log(`Message de ${data.username}: ${data.message}`);
          //break;
          
        //default:
          //console.log('Type de message inconnu:', data);
      //}
    //} catch (error) {
     // console.error('Erreur de traitement du message:', error);
    //}
  //});

  // Gérer la déconnexion
  //ws.on('close', () => {
  //  const client = clients.get(clientId);
  //  if (client) {
      // Annoncer la déconnexion
   //   broadcastMessage({
     //   username: 'Système',
      //  message: `${client.username} a quitté le chat`,
      //});
      
      // Supprimer le client de la liste
     // clients.delete(clientId);
     // console.log(`Client déconnecté: ${client.username}`);
    //}
  //});
//});

// Fonction pour générer un ID unique
//function generateUniqueId() {
 // return Math.random().toString(36).substring(2, 10);
//}

// Fonction pour diffuser un message à tous les clients
//function broadcastMessage(data) {
 // const message = JSON.stringify(data);
  
 // clients.forEach((client) => {
   // if (client.ws.readyState === WebSocket.OPEN) {
    //  client.ws.send(message);
    //}
  //});
//}

// Démarrer le serveur
//server.listen(PORT, () => {
  //console.log(`Serveur démarré sur le port ${PORT}`);
//});
