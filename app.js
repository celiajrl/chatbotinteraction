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
app.use(cors());

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


app.get('/src/fillquestionnaire.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'fillquestionnaire.html'));
  });

// Punto de entrada para activar y probar un chatbot específico
app.get('/:activeId', async (req, res) => {
    const activeId = req.params.activeId;

    try {
        const activeData = await db.collection('active').findOne({ _id: ObjectId(activeId) });
        if (!activeData) {
            return res.status(404).send('This link has already been used.');
        }

        const { chatbotId } = activeData;
        const chatbot = await chatbotController.getChatbotById(chatbotId);
        if (!chatbot) {
            return res.status(404).json({ message: 'Chatbot not found' });
        }

	console.log("Descompresión del archivo ZIP:");
        // Descomprimir el archivo ZIP
        const zipBuffer = Buffer.from(chatbot.zipFile, 'base64');
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo('decompressed', true);

        // Copiar o mover archivos de la carpeta "files" al directorio de destino
        const filesDir = path.join(__dirname, 'files');
        const destDir = 'decompressed';
        fs.readdirSync(filesDir).forEach(file => {
            fs.copyFileSync(path.join(filesDir, file), path.join(destDir, file));
        });

        console.log('Ejecutando script de shell para configurar y entrenar Rasa...');
        

	const child = spawn('./setup_and_train.sh', [], { shell: true });

	child.stdout.on('data', (data) => {
	    console.log(`stdout: ${data}`);
	});

	child.stderr.on('data', (data) => {
	    console.error(`stderr: ${data}`);
	});

	child.on('close', (code) => {
	    console.log(`child process exited with code ${code}`);
	});
	res.sendFile(path.join(__dirname, 'index.html'));


    } catch (error) {
        console.error('Error:', error);
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
