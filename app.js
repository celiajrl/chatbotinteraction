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
        const zipBuffer = Buffer.from(chatbot.zipFile, 'base64');
        const zip = new AdmZip(zipBuffer);
        const extractPath = path.resolve(__dirname, `decompressed/${activeId}`);
        zip.extractAllTo(extractPath, true);

        console.log('Copiando archivos necesarios...');
        const filesDir = path.join(__dirname, 'files');
        fs.readdirSync(filesDir).forEach(file => {
            const sourceFile = path.join(filesDir, file);
            const destFile = path.join(extractPath, file);
            fs.copyFileSync(sourceFile, destFile);
            console.log(`Archivo ${file} copiado a ${destFile}`);
        });

        console.log(`Directorio de extracción: ${extractPath}`);
        console.log(`Directorio actual: ${process.cwd()}`);

        const configFile = path.join(extractPath, 'config.yml');
        const dataDir = path.join(extractPath, 'data');

        if (!fs.existsSync(configFile)) {
            console.error("Archivo config.yml no encontrado.");
            return res.status(500).send("Archivo de configuración no encontrado.");
        }

        if (!fs.existsSync(dataDir)) {
            console.error("Directorio de datos no encontrado.");
            return res.status(500).send("Directorio de datos no encontrado.");
        }

        console.log('Iniciando entrenamiento de Rasa...');
        const train = spawn('/app/venv/bin/rasa', ['train', '--config', configFile, '--data', dataDir], { cwd: extractPath });

        train.stdout.on('data', (data) => {
            console.log(`stdout (train): ${data.toString()}`);
        });

        train.stderr.on('data', (data) => {
            console.error(`stderr (train): ${data.toString()}`);
        });

        train.on('close', (trainExitCode) => {
            if (trainExitCode === 0) {
                console.log('Rasa ha sido entrenado exitosamente.');
                console.log('Iniciando servidor de Rasa...');
                const run = spawn('/app/venv/bin/rasa', ['run', '--enable-api', '--cors', '*', '--port', '5005'], { cwd: extractPath });

		    run.stderr.on('data', (data) => {
		        const output = data.toString();
		        console.log(`stderr (run): ${output}`);
		        if (output.includes("Rasa server is up and running")) {
		            console.log('Rasa server is up and running.');
		            res.sendFile(path.join(__dirname, 'index.html'));
		        }
		    });

		    run.on('error', (error) => {
		        console.error(`Failed to start Rasa server: ${error.message}`);
		        res.status(500).send('Failed to start Rasa server.');
		    });
		    }
		    });
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
