#!/bin/bash

echo "Iniciando el script..."

# Actualizar paquetes y preparar entorno
apt-get update
apt-get install -y python3 python3-pip

# Verificar instalación
echo "Python instalado..."
python3 --version
echo "Pip instalado..."
pip3 --version

python3 -m venv ./venv
echo "Entorno virtual creado..."

source ./venv/bin/activate
echo "Entorno virtual activado..."

pip install rasa
echo "Rasa instalado..."
rasa --version

cd decompressed
echo "Directorio cambiado a decompressed..."

rasa train
echo "Entrenamiento de Rasa completado..."

echo "Iniciando servidor de Rasa..."
rasa run --enable-api --cors "*"

