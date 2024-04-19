const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { ObjectId } = require('mongodb');
const { connectToDb, getDb } = require('./db');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');


const chatbotController = require('./controllers/chatbotController');
const questionnaireController = require('./controllers/questionnaireController');

// Inicialización de la app y middleware
const app = express();
const PORT = process.env.PORT || 3000; 
app.use(express.static(path.join(__dirname, 'src')));
app.use(express.json());
app.use(cors({ origin: '*' }));

// Conexión a la base de datos
let db;

connectToDb((err) => {  
    if (!err) {
        app.listen(PORT, "0.0.0.0", function (){
            console.log(`Servidor escuchando en el puerto ${PORT}`);
        });
        db = getDb();
    } else {
        console.error('Failed to connect to the database:', err);
    }
});

app.get('/', (req, res) => {
  res.send('Hello World!')
})


app.get('/src/fillquestionnaire.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'fillquestionnaire.html'));
  });

// Punto de entrada para activar y probar un chatbot específico 
// Punto de entrada para activar y probar un chatbot específico
app.get('/:activeId', async (req, res) => {
    const activeId = req.params.activeId;

    try {
        console.log(`Fetching active data for ID: ${activeId}`);
        const activeData = await db.collection('active').findOne({ _id: ObjectId(activeId) });
        if (!activeData) {
            console.log('Active data not found or link has been used.');
            return res.status(404).send('This link has already been used.');
        }

        console.log(`Fetching chatbot data for chatbot ID: ${activeData.chatbotId}`);
        const chatbot = await chatbotController.getChatbotById(activeData.chatbotId);
        if (!chatbot) {
            console.log('Chatbot data not found.');
            return res.status(404).json({ message: 'Chatbot not found' });
        }

        console.log(`Retrieving ZIP file from GridFS with ID: ${chatbot.zipFileId}`);
        const { retrieveFileFromGridFS } = require('./db');
        retrieveFileFromGridFS(chatbot.zipFileId, async (err, fileBuffer) => {
            if (err) {
                console.error('Error retrieving file from GridFS:', err);
                return res.status(500).send('Failed to retrieve file from GridFS');
            }

            console.log("File retrieved successfully. Starting to decompress the ZIP file.");
            const zip = new AdmZip(fileBuffer);
            const extractPath = path.resolve(__dirname, `decompressed/${activeId}`);
            zip.extractAllTo(extractPath, true);
            console.log(`File decompressed successfully to ${extractPath}`);

            console.log('Starting to copy necessary files...');
            const filesDir = path.join(__dirname, 'files');
            fs.readdirSync(filesDir).forEach(file => {
                const sourceFile = path.join(filesDir, file);
                const destFile = path.join(extractPath, file);
                fs.copyFileSync(sourceFile, destFile);
                console.log(`File ${file} copied from ${sourceFile} to ${destFile}`);
            });

            console.log('All files copied. Initializing Rasa server...');
        
            const rasaRun = spawn('/app/venv/bin/rasa', ['run', '--enable-api', '--cors', '*', '--port', '5005'], {cwd: extractPath});

            rasaRun.stdout.on('data', (data) => {
                console.log(`Rasa Run STDOUT: ${data.toString()}`);
                if (data.toString().includes("Rasa server is up and running")) {
                    console.log('Rasa server confirmed up and running.');
                    res.sendFile(path.join(__dirname, 'index.html'));
                }
            });

            rasaRun.stderr.on('data', (data) => {
                console.log(`Rasa Run STDERR: ${data.toString()}`);
                if (data.toString().includes("Rasa server is up and running")) {
                    console.log('Rasa server confirmed up and running.');
                    res.sendFile(path.join(__dirname, 'index.html'));
                }
            });

            rasaRun.on('error', (error) => {
                console.error(`Error starting Rasa server: ${error.message}`);
                res.status(500).send('Failed to start Rasa server.');
            });
        });
    } catch (error) {
        console.error('Unhandled error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// VIEW QUESTIONNAIRE
app.get('/questionnaires/:questionnaireId', async (req, res) => {
    const questionnaireId = req.params.questionnaireId;
    try {
        const questionnaire = await questionnaireController.getQuestionnaireInfoWOUser(questionnaireId);
        
        if (!questionnaire) {
            return res.status(404).json({ error: 'Questionnaire not found' });
        }

        res.status(200).json(questionnaire); 
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET ACTIVE
app.get('/active/:activeId', async (req, res) => {
    const activeId = req.params.activeId;
    console.log(activeId);
    try {
        const active = await db.collection('active').findOne({ _id: ObjectId(activeId)});
        
        if (!active) {
            return res.status(404).json({ error: 'Active test not found' });
        }

        res.status(200).json(active); 
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});




app.post('/submit-results', async (req, res) => {
    const { chatbotId, questionnaireId, sus, answers } = req.body;

    try {

        const db = getDb();
        const susCollection = db.collection('results');

        const result = await susCollection.insertOne({ chatbotId, questionnaireId, sus, answers });

        res.status(200).json(result.insertedId);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/complete', async (req, res) => {
    const { userId, participantId, date, questionnaireId, chatbotId, resultId, activeId } = req.body;

    try {
        const result = await db.collection('active').findOneAndUpdate(
            { _id: ObjectId(activeId) },
            { $pull: { questionnaires: ObjectId(questionnaireId) } }, 
            { returnOriginal: false } 
        );

        if (!result.value.questionnaires.length) {
            await db.collection('active').findOneAndDelete({ _id: ObjectId(activeId) });
        }

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
