// Fichier: server.js
const WebSocket = require('ws');
const http = require('http');
const express = require('express');

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

// Gérer les connexions WebSocket
wss.on('connection', (ws) => {
  console.log('Nouveau client connecté');

  // Attribuer un ID unique à chaque client
  const clientId = generateUniqueId();
  let username = 'Anonyme';

  // Stocker la connexion client
  clients.set(clientId, {
    ws,
    username
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
          
          // Annoncer la connexion à tous les clients
          broadcastMessage({
            username: 'Système',
            message: `${username} a rejoint le chat`,
          });
          
          console.log(`Utilisateur connecté: ${username}`);
          break;
          
        case 'message':
          // Diffuser le message à tous les clients
          broadcastMessage({
            username: data.username,
            message: data.message,
          });
          
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
        username: 'Système',
        message: `${client.username} a quitté le chat`,
      });
      
      // Supprimer le client de la liste
      clients.delete(clientId);
      console.log(`Client déconnecté: ${client.username}`);
    }
  });
});

// Fonction pour générer un ID unique
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 10);
}

// Fonction pour diffuser un message à tous les clients
function broadcastMessage(data) {
  const message = JSON.stringify(data);
  
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// Démarrer le serveur
server.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});