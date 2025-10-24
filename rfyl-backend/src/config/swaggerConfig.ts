import dotenv from 'dotenv';
dotenv.config();

import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const PORT = process.env.PORT || 4000;

//Example api doc skeleton
/* 

"ADD_PATHWAY_HERE": {
  "post": {
    "summary": "ENTER_SUMMARY_HERE",
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "type": "object",
            "properties": {
              ADD_PROPERTIES_HERE
              Ex: 
              "email": { "type": "string" },
              "password": { "type": "string" }
            }
          }
        }
      }
    },
    "responses": {
      "200": {
        "description": "Successful login"
      }
      ADD_RESPONSES_HERE_AS_NECESSARY
    }
  }
},

*/

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Run For Your Life API Documentation',
      version: '1.0.0',
      description: 'API documentation for RFYL backend',
    },
    servers: [
      {
        url: `http://localhost:${PORT}/api`,
      },
    ],
    "paths": {
      "/auth/register": {
        "post": {
          "summary": "Register a new user",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "email": { "type": "string" },
                    "password": { "type": "string" }
                  }
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Successful login"
            },
            "401": {
              "description": "Bad email/password" 
            }
          }
        }
      },
      "/auth/login": {
        "post": {
          "summary": "Log in a user",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "email": { "type": "string" },
                    "password": { "type": "string" }
                  }
                }
              }
            }
          },
          "responses": {
            "200": {
              "description": "Successful login"
            },
            "401": {
              "description": "Invalid credentials" 
            }
          }
        }
      },
      "/profile/stats": {
        "get": {
          "summary": "Get stats for a user profile",
          "responses": {
            "200": {
              "description": "A list of stats",
              "content": {
                "application/json": {
                  "schema": {
                    "type": "object",
                    "properties": {
                      "milesRun": { type: "integer" },
                      "territoryCovered": { type: "integer" },
                      "playersDefeated": { type: "integer" },
                      "rank": { type: "integer" }
                    },
                  },
                }
              }
            }
          },
        }
      },
    }
  },
  apis: ['./src/routes/*.ts'],
};

const specs = swaggerJsdoc(options);

export { swaggerUi, specs };
