#!/bin/bash

echo "Iniciando el script..."
python3 -m venv ./venv
echo "Entorno virtual creado..."

source ./venv/bin/activate
echo "Entorno virtual activado..."

pip install rasa
echo "Rasa instalado..."

cd decompressed
echo "Directorio cambiado a decompressed..."

rasa train
echo "Entrenamiento de Rasa completado..."

echo "Iniciando servidor de Rasa..."
rasa run --enable-api --cors "*"

