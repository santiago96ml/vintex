// ============== SERVIDOR BACKEND PARA VINTEX CLINIC (CON DNI DE CLIENTES) ==============

// 1. IMPORTACIÓN DE MÓDULOS
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// 2. CONFIGURACIÓN INICIAL
const app = express();
const port = process.env.PORT || 3001;

// --- Conexión a Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY deben estar definidas.");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 4. RUTAS DE LA API

app.get('/api/initial-data', async (req, res) => {
    console.log("Petición recibida: GET /api/initial-data");
    try {
        const [doctorsRes, appointmentsRes, clientsRes] = await Promise.all([
            supabase.from('doctores').select('id, nombre, activo, horario_inicio, horario_fin'),
            supabase.from('citas').select(`
                id, fecha_hora, descripcion, estado, duracion_minutos,
                cliente: clientes (id, nombre, dni),
                doctor: doctores (id, nombre)
            `),
            // AJUSTE: Ahora también pedimos el DNI en la lista general de clientes
            supabase.from('clientes').select('id, nombre, dni')
        ]);

        if (doctorsRes.error) throw doctorsRes.error;
        if (appointmentsRes.error) throw appointmentsRes.error;
        if (clientsRes.error) throw clientsRes.error;

        console.log(`Datos obtenidos: ${doctorsRes.data.length} doctores, ${appointmentsRes.data.length} citas, ${clientsRes.data.length} clientes.`);
        
        res.status(200).json({
            doctors: doctorsRes.data,
            appointments: appointmentsRes.data,
            clients: clientsRes.data
        });

    } catch (error) {
        console.error("Error en /api/initial-data:", error.message);
        res.status(500).json({ error: 'Error interno del servidor.', details: error.message });
    }
});

app.post('/api/citas', async (req, res) => {
    const { doctor_id, fecha_hora, descripcion, estado, cliente_id, new_client_name, new_client_dni } = req.body;
    
    console.log("Petición recibida para crear cita:", req.body);

    if (!doctor_id || !fecha_hora) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: doctor_id, fecha_hora.' });
    }

    let finalClientId = cliente_id;

    try {
        if (new_client_name && new_client_dni) {
            let { data: existingClient, error: findError } = await supabase
                .from('clientes')
                .select('id')
                .eq('dni', new_client_dni)
                .single();

            if (findError && findError.code !== 'PGRST116') {
                throw findError;
            }

            if (existingClient) {
                console.log(`Cliente con DNI ${new_client_dni} ya existe. Usando ID: ${existingClient.id}`);
                finalClientId = existingClient.id;
            } else {
                console.log(`Creando nuevo cliente: ${new_client_name}`);
                const { data: newClient, error: createError } = await supabase
                    .from('clientes')
                    .insert({ nombre: new_client_name, dni: new_client_dni })
                    .select('id')
                    .single();

                if (createError) throw createError;
                
                finalClientId = newClient.id;
                console.log(`Nuevo cliente creado con ID: ${finalClientId}`);
            }
        }

        if (!finalClientId) {
            return res.status(400).json({ error: 'Se debe seleccionar un cliente existente o crear uno nuevo.' });
        }

        const citaData = {
            cliente_id: finalClientId,
            doctor_id,
            fecha_hora,
            descripcion,
            estado: estado || 'programada'
        };

        const { data: newAppointment, error: appointmentError } = await supabase.from('citas').insert(citaData).select().single();
        if (appointmentError) throw appointmentError;
        
        console.log("Cita creada exitosamente:", newAppointment);
        res.status(201).json(newAppointment);

    } catch (error) {
        console.error("Error al procesar la cita:", error.message);
        res.status(500).json({ error: 'No se pudo procesar la solicitud de cita.', details: error.message });
    }
});

app.patch('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        const { data, error } = await supabase.from('citas').update(updates).eq('id', id).select();
        if (error) throw error;
        res.status(200).json(data[0]);
    } catch (error) {
        res.status(500).json({ error: 'No se pudo actualizar la cita.' });
    }
});

app.delete('/api/citas/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase.from('citas').delete().eq('id', id);
        if (error) throw error;
        res.status(200).json({ message: 'Cita eliminada.' });
    } catch (error) {
        res.status(500).json({ error: 'No se pudo eliminar la cita.' });
    }
});

// 5. INICIO DEL SERVIDOR
app.listen(port, () => {
    console.log(`🚀 ¡Backend de Vintex Clinic está funcionando en http://localhost:${port}!`);
});

