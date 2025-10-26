// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (VERSIÓN CORREGIDA) ==============

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = process.env.PORT || 3001;

// --- Conexión a Supabase (CORRECCIÓN IMPORTANTE) ---
// Ahora se asegura de que las variables de entorno existan antes de continuar.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Usamos la clave ANON pública

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas en el archivo .env");
    process.exit(1); // Detiene la aplicación si faltan las claves
}
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 4. RUTAS DE LA API (Sin cambios en la lógica de las rutas, solo en la conexión)
app.get('/api/data', async (req, res) => {
    console.log("Petición recibida: GET /api/data");
    try {
        const { data, error } = await supabase
            .from('citas')
            .select(`
                id, fecha_hora, descripcion, estado: estado_cita, duracion_minutos,
                cliente: clientes (id, thread_id, nombre: nombre_completo, dni, telefono, correo, historial: historial_conversacion),
                doctor: doctores (id, nombre)
            `);

        if (error) throw error;
        console.log(`Datos obtenidos exitosamente: ${data.length} citas.`);
        res.status(200).json(data);

    } catch (error) {
        console.error("Error en /api/data:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});

// ... (El resto de las rutas POST, PATCH, DELETE no necesitan cambios)
app.post('/api/citas', async (req, res) => {
    // ... (código sin cambios)
});
app.patch('/api/citas/:id', async (req, res) => {
    // ... (código sin cambios)
});
app.delete('/api/citas/:id', async (req, res) => {
   // ... (código sin cambios)
});
app.patch('/api/clientes/:id', async (req, res) => {
   // ... (código sin cambios)
});


// 5. INICIO DEL SERVIDOR
app.listen(port, () => {
    console.log('-------------------------------------------');
    console.log(`🚀 ¡Backend de Vintex Clinic está funcionando!`);
    console.log(`      Listo para recibir peticiones en http://localhost:${port}`);
    console.log('-------------------------------------------');
});
```

**4. Vuelve a iniciar el servidor:**
Guarda los cambios en `server.js`, vuelve a tu terminal y ejecuta de nuevo:
```bash
npm start

