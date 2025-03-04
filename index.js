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

// Historique des messages (stocké en mémoire)
// En production, vous voudriez utiliser une base de données
let messageHistory = [];
const MAX_HISTORY_SIZE = 100; // Limiter le nombre de messages stockés

// Chemin vers le fichier pour stocker les messages (persistence)
const historyFilePath = path.join(__dirname, 'message_history.json');

// Charger l'historique des messages au démarrage
function loadMessageHistory() {
  try {
    if (fs.existsSync(historyFilePath)) {
      const data = fs.readFileSync(historyFilePath, 'utf8');
      messageHistory = JSON.parse(data);
      console.log(`Historique de ${messageHistory.length} messages chargé`);
    } else {
      console.log('Aucun fichier d\'historique trouvé, création d\'un nouvel historique');
      messageHistory = [];
    }
  } catch (error) {
    console.error('Erreur lors du chargement de l\'historique:', error);
    messageHistory = [];
  }
}

// Sauvegarder l'historique des messages
function saveMessageHistory() {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify(messageHistory), 'utf8');
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de l\'historique:', error);
  }
}

// Ajouter un message à l'historique
function addToHistory(message) {
  messageHistory.push(message);
  // Limiter la taille de l'historique
  if (messageHistory.length > MAX_HISTORY_SIZE) {
    messageHistory = messageHistory.slice(-MAX_HISTORY_SIZE);
  }
  // Sauvegarder l'historique
  saveMessageHistory();
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
  clients.set(clientId, { ws, username });
  
  // Gérer les messages du client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Ajouter un timestamp s'il n'existe pas
      const timestamp = data.timestamp || new Date().toISOString();
      
      switch (data.type) {
        case 'join':
          // Mettre à jour le nom d'utilisateur
          username = data.username || 'Anonyme';
          clients.get(clientId).username = username;
          
          // Annoncer la connexion à tous les clients
          const joinMessage = {
            type: 'system',
            username: 'Système',
            message: `${username} a rejoint le chat`,
            timestamp
          };
          
          broadcastMessage(joinMessage);
          addToHistory(joinMessage);
          
          // Envoyer l'historique des messages au client qui vient de se connecter
          sendMessageHistory(ws);
          
          console.log(`Utilisateur connecté: ${username}`);
          break;
          
        case 'message':
          // Créer l'objet message avec toutes les propriétés requises
          const chatMessage = {
            type: 'message',
            username: data.username,
            message: data.message,
            timestamp
          };
          
          // Ajouter le message à l'historique
          addToHistory(chatMessage);
          
          // Diffuser le message à tous les clients SAUF l'expéditeur
          broadcastMessage(chatMessage, clientId);
          
          console.log(`Message de ${data.username}: ${data.message}`);
          break;
          
        case 'disconnect':
          handleDisconnect(clientId);
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
    handleDisconnect(clientId);
  });
});

// Fonction pour gérer la déconnexion d'un client
function handleDisconnect(clientId) {
  const client = clients.get(clientId);
  if (client) {
    // Annoncer la déconnexion
    const disconnectMessage = {
      type: 'system',
      username: 'Système',
      message: `${client.username} a quitté le chat`,
      timestamp: new Date().toISOString()
    };
    
    broadcastMessage(disconnectMessage);
    addToHistory(disconnectMessage);
    
    // Supprimer le client de la liste
    clients.delete(clientId);
    console.log(`Client déconnecté: ${client.username}`);
  }
}

// Fonction pour envoyer l'historique des messages à un client
function sendMessageHistory(ws) {
  if (messageHistory.length > 0) {
    const historyPayload = {
      type: 'history',
      messages: messageHistory
    };
    
    ws.send(JSON.stringify(historyPayload));
  }
}

// Fonction pour générer un ID unique
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 10);
}

// Fonction pour diffuser un message à tous les clients
// Ajoute un paramètre excludeClientId pour éviter d'envoyer au client qui a émis le message
function broadcastMessage(data, excludeClientId = null) {
  const message = JSON.stringify(data);
  
  clients.forEach((client, id) => {
    // N'envoie pas au client exclu (celui qui a envoyé le message)
    if (excludeClientId !== id && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
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
  saveMessageHistory();
  process.exit(0);
});


// // Fichier: server.js
// const WebSocket = require('ws');
// const http = require('http');
// const express = require('express');

// // Initialiser l'application Express
// const app = express();
// const server = http.createServer(app);

// // Configurer le port pour l'hébergement
// const PORT = process.env.PORT || 8080;

// // Page d'accueil simple
// app.get('/', (req, res) => {
//   res.send('Serveur de chat en temps réel actif');
// });

// // Initialiser le serveur WebSocket
// const wss = new WebSocket.Server({ server });

// // Liste des clients connectés
// const clients = new Map();

// // Gérer les connexions WebSocket
// wss.on('connection', (ws) => {
//   console.log('Nouveau client connecté');

//   // Attribuer un ID unique à chaque client
//   const clientId = generateUniqueId();
//   let username = 'Anonyme';

//   // Stocker la connexion client
//   clients.set(clientId, {
//     ws,
//     username
//   });

//   // Gérer les messages du client
//   ws.on('message', (message) => {
//     try {
//       const data = JSON.parse(message);
      
//       switch (data.type) {
//         case 'join':
//           // Mettre à jour le nom d'utilisateur
//           username = data.username || 'Anonyme';
//           clients.get(clientId).username = username;
          
//           // Annoncer la connexion à tous les clients
//           broadcastMessage({
//             username: 'Système',
//             message: `${username} a rejoint le chat`,
//           });
          
//           console.log(`Utilisateur connecté: ${username}`);
//           break;
          
//         case 'message':
//           // Diffuser le message à tous les clients
//           broadcastMessage({
//             username: data.username,
//             message: data.message,
//           });
          
//           console.log(`Message de ${data.username}: ${data.message}`);
//           break;
          
//         default:
//           console.log('Type de message inconnu:', data);
//       }
//     } catch (error) {
//       console.error('Erreur de traitement du message:', error);
//     }
//   });

//   // Gérer la déconnexion
//   ws.on('close', () => {
//     const client = clients.get(clientId);
//     if (client) {
//       // Annoncer la déconnexion
//       broadcastMessage({
//         username: 'Système',
//         message: `${client.username} a quitté le chat`,
//       });
      
//       // Supprimer le client de la liste 
       
//       clients.delete(clientId);
//       console.log(`Client déconnecté: ${client.username}`);
//     }
//   });
// });

// // Fonction pour générer un ID unique
// function generateUniqueId() {
//   return Math.random().toString(36).substring(2, 10);
// }

// // Fonction pour diffuser un message à tous les clients
// function broadcastMessage(data) {
//   const message = JSON.stringify(data);
  
//   clients.forEach((client) => {
//     if (client.ws.readyState === WebSocket.OPEN) {
//       client.ws.send(message);
//     }
//   });
// }

// // Démarrer le serveur
// server.listen(PORT, () => {
//   console.log(`Serveur démarré sur le port ${PORT}`);
// });