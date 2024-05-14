/**
 * app.js
 * 
 * Descripción: Este archivo configura el servidor Express para gestionar rutas API relacionadas con
 *              el despliegue de cuestionarios, de chatbots, la recolección de respuestas, su almacenamiento...
 * 
 * Año: 2024
 * 
 * Autora: Celia Jiménez
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { ObjectId } = require('mongodb');
const { connectToDb, getDb } = require('./db');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const http = require('http');
const { Server } = require("socket.io");

const chatbotController = require('./controllers/chatbotController');
const questionnaireController = require('./controllers/questionnaireController');

// Inicialización de la app y middleware
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'src')));
app.use(express.json());
app.use(cors({ origin: '*' }));


const server = http.createServer(app);
const io = new Server(server);

// Conexión a la base de datos
let db;


connectToDb((err) => {  
    if (!err) {
        server.listen(PORT, "0.0.0.0", function (){
            console.log(`Servidor escuchando en el puerto ${PORT}`);
        });
        db = getDb();
    } else {
        console.error('Failed to connect to the database:', err);
    }
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/src/fillquestionnaire.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'fillquestionnaire.html'));
  });

// Punto de entrada para activar y probar un chatbot específico en función del ID del active
app.get('/interact/:activeId', async (req, res) => {
    const activeId = req.params.activeId; // Obtiene el ID activo de los parámetros de la solicitud

    try {
        // Busca los datos activos en la base de datos utilizando el ID proporcionado
        const activeData = await db.collection('active').findOne({ _id: ObjectId(activeId) });
        // Verifica si no se encontraron datos activos o si el enlace ya se ha utilizado
        if (!activeData) {
            console.log('Active data not found or link has been used.');
            return res.status(404).send('This link has already been used.');
        }        

        // Envía el archivo index.html al cliente como respuesta
        res.sendFile(path.join(__dirname, 'index.html'));
        // Obtiene los datos del chatbot desde el controlador de chatbots utilizando el ID del chatbot asociado
        const chatbot = await chatbotController.getChatbotById(activeData.chatbotId);
        // Verifica si los datos del chatbot no se encontraron
        if (!chatbot) {
            console.log('Chatbot data not found.');
            return res.status(404).json({ message: 'Chatbot not found' });
        }

        // Importa la función 'retrieveFileFromGridFS' desde el módulo 'db'
        const { retrieveFileFromGridFS } = require('./db');
        // Recupera el archivo ZIP del GridFS utilizando su ID
        retrieveFileFromGridFS(chatbot.zipFileId, async (err, fileBuffer) => {
            // Maneja los errores si ocurre algún problema al recuperar el archivo ZIP
            if (err) {
                console.error('Error retrieving file from GridFS:', err);
                return res.status(500).send('Failed to retrieve file from GridFS');
            }

            // Inicializa un objeto AdmZip con el búfer del archivo ZIP
            const zip = new AdmZip(fileBuffer);
            // Define la ruta de extracción para descomprimir el archivo ZIP
            const extractPath = path.resolve(__dirname, `decompressed/${activeId}`);
            // Descomprime el archivo ZIP en la ruta especificada
            zip.extractAllTo(extractPath, true);

            // Define el directorio que contiene los archivos necesarios
            const filesDir = path.join(__dirname, 'files');
            // Itera sobre los archivos en el directorio y los copia a la ruta de extracción
            fs.readdirSync(filesDir).forEach(file => {
                const sourceFile = path.join(filesDir, file);
                const destFile = path.join(extractPath, file);
                fs.copyFileSync(sourceFile, destFile);
            });
        
            // Inicia un proceso Rasa utilizando la ruta de extracción como directorio de trabajo
            const rasaRun = spawn('/app/venv/bin/rasa', ['run', '--enable-api', '--cors', '*', '--port', '5005'], {cwd: extractPath});

            // Captura la salida estándar del proceso Rasa
            rasaRun.stdout.on('data', (data) => {
                console.log(`Rasa Run STDOUT: ${data.toString()}`);
                // Emite el evento 'rasaReady' cuando el servidor Rasa esté listo
                if (data.toString().includes("Rasa server is up and running")) {
                    console.log('Rasa server confirmed up and running.');
                    io.emit('rasaReady');
                }
            });
            // Captura la salida de error del proceso Rasa
            rasaRun.stderr.on('data', (data) => {
                console.error(`Rasa Run STDERR: ${data.toString()}`);
                // Emite el evento 'rasaReady' cuando el servidor Rasa esté listo
                if (data.toString().includes("Rasa server is up and running")) {
                    console.log('Rasa server confirmed up and running.');
                    io.emit('rasaReady');
                }
            });

            // Maneja cualquier error al iniciar el servidor Rasa
            rasaRun.on('error', (error) => {
                console.error(`Error starting Rasa server: ${error.message}`);
                res.status(500).send('Failed to start Rasa server.');
            });
        });
    } catch (error) {
        // Maneja cualquier error no controlado
        console.error('Unhandled error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Ruta para obtener información de un cuestionario específico
app.get('/questionnaires/:questionnaireId', async (req, res) => {
    const questionnaireId = req.params.questionnaireId;
    try {
        // Obtiene la información del cuestionario sin incluir la información del usuario
        const questionnaire = await questionnaireController.getQuestionnaireInfoWOUser(questionnaireId);
        
        // Verifica si el cuestionario no fue encontrado
        if (!questionnaire) {
            return res.status(404).json({ error: 'Questionnaire not found' });
        }

        // Envía la información del cuestionario como respuesta
        res.status(200).json(questionnaire); 
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Ruta para obtener información sobre una prueba activa específica
app.get('/active/:activeId', async (req, res) => {
    const activeId = req.params.activeId;
    try {
        // Busca y devuelve información sobre la prueba activa utilizando su ID
        const active = await db.collection('active').findOne({ _id: ObjectId(activeId)});
        
        // Verifica si la prueba activa no fue encontrada
        if (!active) {
            return res.status(404).json({ error: 'Active test not found' });
        }

        // Envía la información de la prueba activa como respuesta
        res.status(200).json(active); 
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Ruta para enviar resultados de un cuestionario completado
app.post('/submit-results', async (req, res) => {
    const { chatbotId, participantId, questionnaireId, sus, answers } = req.body;

    try {
        // Inserta los resultados del cuestionario en la base de datos
        const db = getDb();
        const susCollection = db.collection('results');
        const result = await susCollection.insertOne({ chatbotId, questionnaireId, sus, answers });

        // Envía la ID del resultado insertado como respuesta
        res.status(200).json(result.insertedId);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Ruta para marcar un cuestionario como completado
app.post('/complete', async (req, res) => {
    const { userId, participantId, date, questionnaireId, questionnaireName, chatbotId, resultId, activeId } = req.body;

    try {
        // Convertir questionnaireId a un ObjectId para realizar operaciones en MongoDB.
        const qId = ObjectId(questionnaireId);
        // Actualiza el documento activo para eliminar el cuestionario completado
        const result = await db.collection('active').findOneAndUpdate(
            { _id: ObjectId(activeId) }, // Localizar el documento activo por su ID
            { 
                $pull: { 
                    questionnaires: ObjectId(questionnaireId), // Eliminar el questionnaireId del array de questionnaires
                    order: { questionnaireId: questionnaireId } // Eliminar el objeto de `order` que tenga este questionnaireId
                },
                $unset: {
                    [`questionnairesName.${questionnaireId}`]: "" // Eliminar la entrada del diccionario por el questionnaireId
                }
            },
            {
                returnDocument: 'after' // Devolver el documento después de la actualización
            }
        );

        // Verifica si todos los cuestionarios han sido completados y si es así, elimina el documento activo
        if (result && result.value && (!result.value.questionnaires || result.value.questionnaires.length === 1)) {
            await db.collection('active').deleteOne({ _id: ObjectId(activeId) });
        }
        
        // Inserta datos en la colección 'complete'
        const completeData = {
            userId: userId,
            participantId: participantId,
            date: date,
            questionnaireId: questionnaireId,
            chatbotId: chatbotId,
            resultId: resultId
        };
        await db.collection('complete').insertOne(completeData);

        res.status(200).json({ message: 'Complete object added successfully', resultId: resultId });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = app;
