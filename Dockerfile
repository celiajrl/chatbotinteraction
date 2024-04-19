# Usar una imagen base que incluya Python y Node.js
FROM nikolaik/python-nodejs:python3.9-nodejs14

# Configurar el directorio de trabajo en el contenedor
WORKDIR /app

# Instalar dependencias del sistema necesarias para compilar ciertas dependencias de Python
RUN apt-get update && apt-get install -y \
    build-essential \
    libssl-dev \
    libffi-dev \
    python3-dev \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copiar el archivo de requisitos y otros necesarios para el proyecto
COPY requirements.txt .

# Instalar Rasa y otras dependencias de Python dentro del entorno virtual
RUN python -m venv ./venv && \
    . ./venv/bin/activate && \
    pip install --upgrade pip && \
    pip install -r requirements.txt

# Exponer el puerto en el que Rasa y Node.js podrían correr
EXPOSE 5005 3000

# Copiar el resto del código fuente al contenedor
COPY . .

# Comando por defecto para ejecutar al iniciar el contenedor, esto sólo inicia Node.js
CMD ["node", "app.js"]

