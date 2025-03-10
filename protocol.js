const fs = require('fs');
const path = require('path');

class Protocol {
  constructor() {
    const protocolPath = path.join(__dirname, 'protocol.json');
    const protocolData = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
    
    this.VERSION = protocolData.VERSION;
    
    // Créer des références simplifiées pour les types de messages
    this.USER = {};
    Object.entries(protocolData.USER_MESSAGES).forEach(([key, value]) => {
      this.USER[key] = value;
    });
    
    this.SYSTEM = {};
    Object.entries(protocolData.SYSTEM_MESSAGES).forEach(([key, value]) => {
      this.SYSTEM[key] = value;
    });
    
    this.ERRORS = protocolData.ERROR_CODES;
  }

  validateMessage(message) {
    // Trouver la spécification correspondant au type de message
    let messageSpec = null;
    Object.values(this.USER).forEach(spec => {
      if (spec.type === message.type) {
        messageSpec = spec;
      }
    });
    
    if (!messageSpec) {
      return {
        isValid: false,
        error: 'Type de message invalide',
        code: this.ERRORS.INVALID_MESSAGE
      };
    }

    for (const required of messageSpec.required) {
      if (message[required] === undefined || message[required] === null) {
        return {
          isValid: false,
          error: `Champ requis manquant: ${required}`,
          code: this.ERRORS.INVALID_MESSAGE
        };
      }
    }

    return { isValid: true };
  }

  createSystemMessage(type, data) {
    const messageSpec = this.SYSTEM[type];
    if (!messageSpec) {
      throw new Error(`Type de message système inconnu: ${type}`);
    }

    return {
      type: messageSpec.type,
      ...data
    };
  }
}

module.exports = new Protocol();