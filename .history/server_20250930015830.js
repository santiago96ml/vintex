// ============== SERVIDOR BACKEND PARA VINTEX CLINIC ==============

// Importamos las librerías necesarias
require('dotenv').config(); // Para cargar variables de entorno desde .env
const express = require('express'); // Framework para crear el servidor
const Airtable = require('airtable'); // Cliente de Airtable
const cors = require('cors'); // Para habilitar Cross-Origin Resource Sharing

// --- CONFIGURACIÓN INICIAL DEL SERVIDOR ---
const app = express();
const port = process.env.PORT || 3000; // El servidor escuchará en el puerto 3000 o el definido en las variables de entorno

// --- CONFIGURACIÓN DE AIRTABLE ---
// Usamos las claves de forma segura desde el archivo .env
Airtable.configure({
    apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);

// Nombres de tus tablas en Airtable
const clientInfoTable = base('Citas'); // Tabla de detalles de clientes
const scheduledAppointmentsTable = base('Citas Agendadas'); // Tabla de citas agendadas

// --- MIDDLEWARE ---
app.use(cors()); // Habilita CORS para permitir peticiones desde tu frontend
app.use(express.json()); // Permite al servidor entender los cuerpos de las peticiones en formato JSON

// --- RUTAS DE LA API (ENDPOINTS) ---

/**
 * @route GET /api/data
 * @description Obtiene todas las citas de 'Citas Agendadas' y las combina con la información detallada
 * de los clientes de la tabla 'Citas' usando el 'Thread ID'.
 * Esto reemplaza múltiples llamadas y procesamiento complejo en el frontend,
 * optimizando la carga inicial de datos.
 */
app.get('/api/data', async (req, res) => {
    console.log("Petición recibida: GET /api/data");
    try {
        // Ejecutamos ambas peticiones a Airtable en paralelo para mayor eficiencia
        const [clientInfoRecords, scheduledRecords] = await Promise.all([
            clientInfoTable.select().all(),
            scheduledAppointmentsTable.select().all()
        ]);

        // Mapeamos los campos de 'Citas' para un acceso más fácil
        const clientsMap = new Map();
        clientInfoRecords.forEach(record => {
            const threadId = record.fields['Thread ID'];
            if (threadId) {
                clientsMap.set(threadId, { id: record.id, ...record.fields });
            }
        });

        // Combinamos los datos de 'Citas Agendadas' con los detalles de 'Citas'
        const combinedAppointments = scheduledRecords.map(scheduledRecord => {
            const threadId = scheduledRecord.fields['Thread ID'];
            const clientRecord = clientsMap.get(threadId);

            // Solo incluimos la cita si encontramos un cliente asociado
            if (!clientRecord) {
                console.warn(`Cita agendada (ID: ${scheduledRecord.id}) sin Thread ID o cliente asociado.`);
                return null;
            }

            // Aquí se combinan los campos de ambas tablas
            // Usamos los nombres de columna exactos de tu Airtable
            return {
                id: scheduledRecord.id, // ID del registro de la cita agendada
                patientName: scheduledRecord.fields['Nombre Paciente'] || clientRecord['Nombre y Apellido'] || 'Sin Nombre',
                dni: clientRecord['DNI'] || '',
                phone: scheduledRecord.fields['Teléfono'] || clientRecord['Teléfono'] || '',
                email: clientRecord['Correo'] || '',
                doctorName: scheduledRecord.fields['Doctor Asignado'] || clientRecord['Doctor'] || '',
                service: clientRecord['Servicio'] || '', // Este viene de 'Citas'
                description: clientRecord['Descripción'] || '', // Este viene de 'Citas'
                start: scheduledRecord.fields['Fecha de Cita'] && scheduledRecord.fields['Hora de Cita']
                       ? `${scheduledRecord.fields['Fecha de Cita']}T${scheduledRecord.fields['Hora de Cita']}:00Z` // Formato ISO para Date
                       : null,
                status: scheduledRecord.fields['Estado de Cita'] || clientRecord['Estado de la cita'] || 'Agendada',
                conversation: clientRecord['Historial de Conversación'] || '',
                threadId: threadId,
                clientRecordId: clientRecord.id // Guardamos el ID del registro en 'Citas'
            };
        }).filter(Boolean); // Filtramos cualquier cita que no se pudo combinar

        console.log(`Datos obtenidos y combinados: ${combinedAppointments.length} citas.`);
        res.json({ allAppointments: combinedAppointments });

    } catch (error) {
        console.error("Error al obtener datos combinados de Airtable:", error);
        res.status(500).json({ error: 'No se pudieron obtener los datos combinados de Airtable.' });
    }
});

/**
 * @route PATCH /api/appointments/:table/:id
 * @description Actualiza un registro existente en una tabla específica de Airtable.
 * Se usa para actualizar citas (en 'Citas Agendadas') y el historial (en 'Citas').
 * @param {string} table - Nombre de la tabla ('Citas' o 'Citas Agendadas').
 * @param {string} id - ID del registro a actualizar.
 * @param {object} fields - Objeto con los campos a actualizar.
 */
app.patch('/api/appointments/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    const { fields } = req.body;
    
    console.log(`Petición recibida: PATCH /api/appointments/${table}/${id} con campos:`, fields);

    let targetTable;
    if (table === 'Citas') {
        targetTable = clientInfoTable;
    } else if (table === 'Citas Agendadas') {
        targetTable = scheduledAppointmentsTable;
    } else {
        return res.status(400).json({ error: 'Tabla no válida especificada para la actualización.' });
    }

    try {
        const updatedRecord = await targetTable.update(id, fields);
        console.log(`Registro ${id} en ${table} actualizado.`);
        res.json(updatedRecord);
    } catch (error) {
        console.error(`Error al actualizar el registro ${id} en la tabla ${table}:`, error);
        res.status(500).json({ error: `No se pudo actualizar el registro en ${table}.` });
    }
});

/**
 * @route POST /api/appointments/:table
 * @description Crea un nuevo registro en una tabla específica de Airtable.
 * Se usa para crear nuevas citas (en 'Citas Agendadas') y si es necesario,
 * un registro de cliente base (en 'Citas').
 * @param {string} table - Nombre de la tabla ('Citas' o 'Citas Agendadas').
 * @param {object[]} records - Array de objetos con los campos para los nuevos registros.
 */
app.post('/api/appointments/:table', async (req, res) => {
    const { table } = req.params;
    const { records } = req.body; // Esperamos un array 'records' según la API de Airtable para POST
    
    console.log(`Petición recibida: POST /api/appointments/${table} con ${records.length} registros.`);

    let targetTable;
    if (table === 'Citas') {
        targetTable = clientInfoTable;
    } else if (table === 'Citas Agendadas') {
        targetTable = scheduledAppointmentsTable;
    } else {
        return res.status(400).json({ error: 'Tabla no válida especificada para la creación.' });
    }

    try {
        const createdRecords = await targetTable.create(records);
        console.log(`Registros creados en ${table} exitosamente.`);
        res.status(201).json(createdRecords); // 201 Created
    } catch (error) {
        console.error(`Error al crear registros en ${table}:`, error);
        res.status(500).json({ error: `No se pudieron crear los registros en ${table}.` });
    }
});

/**
 * @route DELETE /api/appointments/:table/:id
 * @description Elimina un registro existente de una tabla específica de Airtable.
 * @param {string} table - Nombre de la tabla ('Citas' o 'Citas Agendadas').
 * @param {string} id - ID del registro a eliminar.
 */
app.delete('/api/appointments/:table/:id', async (req, res) => {
    const { table, id } = req.params;

    console.log(`Petición recibida: DELETE /api/appointments/${table}/${id}`);

    let targetTable;
    if (table === 'Citas') {
        targetTable = clientInfoTable;
    } else if (table === 'Citas Agendadas') {
        targetTable = scheduledAppointmentsTable;
    } else {
        return res.status(400).json({ error: 'Tabla no válida especificada para la eliminación.' });
    }

    try {
        // Airtable's delete returns an array of records that were deleted
        const deletedRecords = await targetTable.destroy(id);
        if (deletedRecords.length > 0) {
            console.log(`Registro ${id} en ${table} eliminado.`);
            res.json({ message: 'Registro eliminado exitosamente.', deletedRecordId: id });
        } else {
            console.warn(`Intento de eliminar registro ${id} en ${table}, pero no se encontró.`);
            res.status(404).json({ error: 'Registro no encontrado.' });
        }
    } catch (error) {
        console.error(`Error al eliminar registro:`, error);
        res.status(500).json({ error: 'No se pudo eliminar el registro.' });
    }
});


// --- INICIO DEL SERVIDOR ---
app.listen(port, () => {
    console.log(`¡Backend de Vintex Clinic está funcionando!`);
    console.log(`Escuchando en http://localhost:${port}`);
});