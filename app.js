// CONFIGURACIÓN FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyDyp5J2ZRWpA8lRupKD5xfPOyd407bD020",
    authDomain: "capa-limache-sistema.firebaseapp.com",
    projectId: "capa-limache-sistema",
    storageBucket: "capa-limache-sistema.firebasestorage.app",
    messagingSenderId: "173615478102",
    appId: "1:173615478102:web:f711d94b4942ea926352f7"
};

// Evitar crasheo al inicializar apps múltiples (muy común en WebViews/APK)
if (!firebase.apps.length) { 
    firebase.initializeApp(firebaseConfig); 
}
const secondaryApp = firebase.apps.length < 2 ? firebase.initializeApp(firebaseConfig, "Secondary") : firebase.app("Secondary");

const db = firebase.firestore();
const auth = firebase.auth();

let userProfile = null;
let globalCoursesData = []; 
let globalCourses = []; 
let lockedCourse = null;

// ==========================================
// UI & MODALES Y MENÚ MÓVIL
// ==========================================
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
}

function showLoginForm(role) {
    document.getElementById('selected-role-hidden').value = role;
    document.getElementById('role-selection-step').classList.add('hidden');
    document.getElementById('login-form-step').classList.remove('hidden');
    const titles = { 'alumno': 'Acceso Estudiantes', 'profesor': 'Acceso Docentes', 'admin': 'Acceso Dirección' };
    document.getElementById('login-form-title').textContent = titles[role];
}

function goBackToRoles() {
    document.getElementById('login-form-step').classList.add('hidden');
    document.getElementById('role-selection-step').classList.remove('hidden');
    document.getElementById('l-user').value = ''; 
    document.getElementById('l-pass').value = '';
    const btn = document.getElementById('btn-login');
    if(btn) { btn.innerHTML = 'ACCEDER'; btn.disabled = false; }
}

function togglePassword(id) {
    const input = document.getElementById(id); const icon = input.nextElementSibling.querySelector('i');
    if (input.type === 'password') { input.type = 'text'; icon.className = 'far fa-eye-slash'; } 
    else { input.type = 'password'; icon.className = 'far fa-eye'; }
}

function showToast(msg, type = 'success') {
    const c = document.getElementById('toast-container'); if(!c) return;
    const t = document.createElement('div'); t.className = 'toast-modern ' + type;
    t.innerHTML = `<i class="fas ${type==='error'?'fa-exclamation-circle':'fa-check-circle'}" style="color:var(--c-${type==='error'?'orange':'teal'}); font-size:1.2rem;"></i> <span>${msg}</span>`;
    c.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; t.style.transition = '0.3s'; setTimeout(()=> t.remove(), 300); }, 4000);
}

function promptActionCustom(titulo, descripcion, showInput = false, placeholder = "") {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-modal-overlay');
        document.getElementById('modal-title').textContent = titulo;
        document.getElementById('modal-desc').textContent = descripcion;
        const input = document.getElementById('modal-input');
        if (showInput) { input.classList.remove('hidden'); input.placeholder = placeholder; input.value = ''; document.getElementById('modal-icon').innerHTML = '<i class="fas fa-edit" style="color:var(--c-teal)"></i>'; } 
        else { input.classList.add('hidden'); document.getElementById('modal-icon').innerHTML = '<i class="fas fa-exclamation-triangle" style="color:var(--danger)"></i>'; }
        overlay.classList.remove('hidden');
        document.getElementById('modal-btn-confirm').onclick = () => { overlay.classList.add('hidden'); input.classList.add('hidden'); resolve(showInput ? input.value.trim() : true); };
        document.getElementById('modal-btn-cancel').onclick = () => { overlay.classList.add('hidden'); input.classList.add('hidden'); resolve(showInput ? null : false); };
    });
}

function formatDateExact(dateObj) {
    if(!dateObj) return '';
    const d = dateObj.toDate ? dateObj.toDate() : new Date(dateObj);
    return d.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function normalizeString(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

// ==========================================
// AUTH & NAVEGACIÓN A PRUEBA DE FALLOS
// ==========================================
async function handleLogin(event) {
    if (event) event.preventDefault(); // Detiene la recarga de página en móviles
    
    const user = document.getElementById('l-user').value.trim(); const pass = document.getElementById('l-pass').value;
    if (!user || !pass) return showToast('Complete los campos', 'error');
    
    const btn = document.getElementById('btn-login'); 
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; 
    btn.disabled = true;
    
    try {
        const email = user.includes('@') ? user : user.toLowerCase() + '@capa.local';
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (e) { 
        showToast('Credenciales incorrectas', 'error'); 
        btn.innerHTML = 'ACCEDER'; btn.disabled = false; 
    }
}

auth.onAuthStateChanged(async (user) => {
    if (user) {
        try {
            const doc = await db.collection('usuarios').doc(user.uid).get();
            if (!doc.exists) { 
                showToast('Tu cuenta no tiene un perfil en la base de datos.', 'error'); 
                await auth.signOut();
                return;
            }
            
            userProfile = { uid: user.uid, ...doc.data() };
            const roleExpected = document.getElementById('selected-role-hidden').value;
            const dbRol = (userProfile.rol || '').toLowerCase();
            
            // Validación de roles flexible
            if (roleExpected && !dbRol.includes(roleExpected)) {
                showToast('Estás entrando al portal equivocado para tu rol.', 'error');
                await auth.signOut(); 
                goBackToRoles(); 
                return;
            }
            
            // MOSTRAR LA APP INMEDIATAMENTE (Evita que el usuario crea que lo botó)
            document.getElementById('login-screen').style.display = 'none'; 
            document.getElementById('app').style.display = 'block';

            configureUIForRole(); 
            
            // Cargar datos en paralelo, si falla no cierra la sesión
            loadInitialData().catch(err => {
                console.error("Error cargando datos:", err);
                showToast('Cargando datos con conexión limitada.', 'warning');
            });
            
            const today = new Date().toISOString().split('T')[0];
            ['asist-fecha', 'mat-fecha'].forEach(id => { 
                const el = document.getElementById(id);
                if(el) el.value = today; 
            });
            
            const btn = document.getElementById('btn-login');
            if(btn) { btn.innerHTML = 'ACCEDER'; btn.disabled = false; }
            
        } catch (error) { 
            console.error("Error iniciando sesión: ", error);
            // NO se hace auth.signOut() aquí. Mantenemos al usuario adentro.
            showToast('Problemas conectando con el servidor. Revisa tu internet.', 'error');
        }
    } else {
        userProfile = null; globalCourses = []; globalCoursesData = []; lockedCourse = null;
        document.getElementById('login-screen').style.display = 'flex'; 
        document.getElementById('app').style.display = 'none'; 
        goBackToRoles();
    }
});

function configureUIForRole() {
    const rol = userProfile.rol.toLowerCase(); 
    const isAdmin = rol.includes('admin'); 
    const isAlumno = rol === 'alumno';
    
    document.getElementById('u-name-display').textContent = userProfile.nombre;
    document.getElementById('u-rol-display').textContent = isAlumno ? 'Estudiante' : (isAdmin ? 'Dirección' : 'Docente');
    document.getElementById('u-role-label').textContent = isAlumno ? 'ESTUDIANTE' : (isAdmin ? 'ADMINISTRADOR' : 'PROFESOR');
    document.getElementById('user-initial').textContent = userProfile.nombre.charAt(0).toUpperCase();

    document.querySelectorAll('.nav-item.nav-admin-only').forEach(el => {
        if(isAdmin) el.classList.remove('hidden'); else el.classList.add('hidden');
    });
    document.querySelectorAll('.nav-item.nav-staff-admin').forEach(el => {
        if(isAlumno) el.classList.add('hidden'); else el.classList.remove('hidden');
    });
    
    const dbStaff = document.getElementById('dashboard-staff');
    const dbAlumno = document.getElementById('dashboard-alumno');
    
    if (isAlumno) {
        dbStaff.classList.add('hidden');
        dbAlumno.classList.remove('hidden');
    } else {
        dbStaff.classList.remove('hidden');
        dbAlumno.classList.add('hidden');
    }
}

function nav(pageId, element) {
    document.querySelectorAll('.page').forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
    const target = document.getElementById(pageId); 
    if(target) { target.classList.add('active'); target.style.display = 'block'; }
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    if (element) element.classList.add('active');

    // Cierra el menú al hacer clic en móvil
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }
}

async function loadInitialData() {
    const rol = userProfile.rol.toLowerCase();
    
    await syncGlobalCourses(); 
    
    if (rol === 'alumno') { 
        renderStudentDashboard(); 
        loadMessages(true); 
    } else {
        loadMessages(false); 
        if (rol.includes('admin')) loadAdminData();
    }
    
    unlockCourse(); 
    nav('p-home', document.querySelector('.nav-item[data-page="p-home"]'));
}

// ==========================================
// MOTOR MAESTRO DE CURSOS (PROTEGIDO CONTRA CRASHES)
// ==========================================
async function syncGlobalCourses() {
    let coursesNamesSet = new Set();
    let coursesMetaData = {};

    try {
        const cursosSnap = await db.collection('cursos').get();
        cursosSnap.forEach(doc => {
            const d = doc.data();
            coursesNamesSet.add(d.nombre.trim());
            coursesMetaData[d.nombre.trim().toLowerCase()] = { id: doc.id, ...d };
        });
    } catch(e) { console.warn("Aviso de lectura en cursos: ", e); }

    try {
        const profesSnap = await db.collection('usuarios').where('rol', '==', 'profesor').get();
        profesSnap.forEach(doc => {
            const cList = doc.data().cursos || [];
            cList.forEach(c => { if(c.trim()) coursesNamesSet.add(c.trim()) });
        });
    } catch(e) { console.warn("Aviso de lectura en profesores: ", e); }

    globalCourses = Array.from(coursesNamesSet).sort((a,b)=>a.localeCompare(b));

    globalCoursesData = globalCourses.map(nombre => {
        const meta = coursesMetaData[nombre.toLowerCase()] || {};
        return {
            nombre: nombre,
            jornada: meta.jornada || 'No definida',
            docente: meta.docente || 'No asignado',
            mesInicio: meta.mesInicio || '-',
            mesTermino: meta.mesTermino || '-',
            duracion: meta.duracion || '-',
            horario: meta.horario || 'No definido',
            id: meta.id || null
        };
    });

    const isProfe = userProfile.rol.toLowerCase() === 'profesor';
    if (isProfe) {
        const misCursos = (userProfile.cursos || []).map(c=>c.trim().toLowerCase());
        globalCoursesData = globalCoursesData.filter(c => misCursos.includes(c.nombre.toLowerCase()));
        globalCourses = globalCoursesData.map(c=>c.nombre);
    }

    updateAdminSelects();
    
    if(!userProfile.rol.toLowerCase().includes('alumno')) {
        renderStaffDashboard();
        if(userProfile.rol.toLowerCase().includes('admin')) renderAdminCursosOficiales();
    }
}

function updateAdminSelects() {
    const sel = document.getElementById('adm-prof-curso-select');
    if(sel) {
        sel.innerHTML = '<option value="">-- Seleccione un Curso --</option>';
        globalCourses.forEach(c => sel.innerHTML += `<option value="${c}">${c}</option>`);
        sel.innerHTML += `<option value="NUEVO" style="font-weight:bold; color:var(--c-blue-accent);">+ Escribir nuevo curso...</option>`;
    }
}

function toggleManualCourseInput() {
    const sel = document.getElementById('adm-prof-curso-select');
    const input = document.getElementById('adm-prof-nuevo-curso');
    if(sel.value === 'NUEVO') {
        input.classList.remove('hidden');
        input.focus();
    } else {
        input.classList.add('hidden');
        input.value = '';
    }
}

function toggleNewCourseVisibility() {
    const rol = document.getElementById('adm-nuevo-rol').value;
    const container = document.getElementById('container-asignar-curso');
    if(rol === 'admin') {
        container.style.display = 'none';
    } else {
        container.style.display = 'block';
    }
}

function renderStaffDashboard() {
    const c = document.getElementById('global-dashboard');
    if(c) {
        c.innerHTML = '';
        const colores = ['pastel-yellow', 'pastel-blue', 'pastel-green', 'pastel-purple', 'pastel-pink'];
        if(globalCoursesData.length === 0) c.innerHTML = '<p class="text-muted" style="grid-column: 1/-1;">No tienes cursos asignados.</p>';
        
        globalCoursesData.forEach((curso, index) => { 
            const colorClase = colores[index % colores.length];
            
            let deleteBtn = '';
            if(userProfile.rol.toLowerCase().includes('admin')) {
                deleteBtn = `<button class="card-delete-btn" title="Eliminar Curso de Raíz" onclick="event.stopPropagation(); eliminarCursoOficial('${curso.id}', '${curso.nombre}')"><i class="fas fa-times"></i></button>`;
            }

            c.innerHTML += `
                <div class="pastel-card ${colorClase}" onclick="openCourse('${curso.nombre}')">
                    ${deleteBtn}
                    <i class="fas fa-layer-group pastel-icon" style="margin-bottom:10px;"></i>
                    <h3>${curso.nombre}</h3>
                    <div style="font-size:0.75rem; color:rgba(0,0,0,0.8); text-align:left; background:rgba(255,255,255,0.5); padding:10px; border-radius:10px; margin-top:10px; line-height:1.5;">
                        <div><b>👨‍🏫 Docente:</b> ${curso.docente}</div>
                        <div><b>⏱️ Jornada:</b> ${curso.jornada}</div>
                        <div><b>📅 Horario:</b> ${curso.horario}</div>
                        <div><b>🗓️ Periodo:</b> ${curso.mesInicio} a ${curso.mesTermino}</div>
                    </div>
                </div>`; 
        });
        document.getElementById('stat-total-cursos').textContent = globalCoursesData.length;
        db.collection('alumnos').get().then(s => {
            const el = document.getElementById('stat-total-alumnos');
            if(el) el.textContent = s.size;
        }).catch(e => console.warn("Permiso denegado al contar alumnos", e));
    }
}

function openCourse(curso) {
    lockedCourse = curso;
    document.getElementById('active-course-badge').classList.remove('hidden');
    document.getElementById('active-course-name').textContent = curso;
    
    ['asist', 'notas', 'bitacora', 'reportes'].forEach(sec => {
        const empty = document.getElementById(`empty-${sec}`);
        const content = document.getElementById(`content-${sec}`);
        if(empty) empty.classList.add('hidden');
        if(content) content.classList.remove('hidden');
    });
    
    document.querySelectorAll('.display-active-course').forEach(el => el.textContent = curso);
    
    renderNotesList(); renderAttendanceList(); loadBitacora();
    nav('p-notas', document.querySelector('.nav-item[data-page="p-notas"]'));
}

function unlockCourse() {
    lockedCourse = null;
    document.getElementById('active-course-badge').classList.add('hidden');
    
    ['asist', 'notas', 'bitacora', 'reportes'].forEach(sec => {
        const empty = document.getElementById(`empty-${sec}`);
        const content = document.getElementById(`content-${sec}`);
        if(empty) empty.classList.remove('hidden');
        if(content) content.classList.add('hidden');
    });
    
    nav('p-home', document.querySelector('.nav-item[data-page="p-home"]'));
}

async function getAlumnosDelCurso(nombreCurso) {
    try {
        const snap = await db.collection('alumnos').get();
        let alumnos = [];
        const searchString = normalizeString(nombreCurso);
        snap.forEach(d => {
            const c = normalizeString(d.data().curso);
            if (c === searchString) alumnos.push({id: d.id, ...d.data()});
        });
        return alumnos;
    } catch(e) {
        console.warn("Fallo al obtener alumnos del curso", e);
        return [];
    }
}

// ==========================================
// ADMIN: CREAR Y ELIMINAR CURSOS OFICIALES
// ==========================================
async function crearCursoOficial() {
    const nombre = document.getElementById('c-nombre').value.trim();
    const docente = document.getElementById('c-docente').value.trim();
    const jornada = document.getElementById('c-jornada').value;
    const inicio = document.getElementById('c-inicio').value.trim();
    const fin = document.getElementById('c-fin').value.trim();
    const duracion = document.getElementById('c-duracion').value.trim();
    const horario = document.getElementById('c-horario').value.trim();

    if(!nombre) return showToast('El nombre del curso es obligatorio', 'warning');

    await db.collection('cursos').add({
        nombre, docente, jornada, mesInicio: inicio, mesTermino: fin, duracion, horario, createdAt: new Date()
    });

    showToast('Curso creado exitosamente');
    document.querySelectorAll('#c-nombre, #c-docente, #c-inicio, #c-fin, #c-duracion, #c-horario').forEach(i => i.value='');
    syncGlobalCourses();
}

function renderAdminCursosOficiales() {
    const c = document.getElementById('admin-cursos-oficiales-list');
    if(!c) return;
    c.innerHTML = '';
    
    const cursosReales = globalCoursesData.filter(curso => curso.id !== null);
    if(cursosReales.length === 0) { c.innerHTML = '<p class="text-muted">No hay cursos creados oficialmente.</p>'; return; }

    cursosReales.forEach(curso => {
        c.innerHTML += `
            <div style="background:var(--bg-main); padding:15px; border-radius:12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border:1px solid var(--border-light);">
                <div>
                    <h4 style="margin:0; color:var(--c-dark);">${curso.nombre}</h4>
                    <p style="margin:0; font-size:0.8rem; color:var(--text-muted);">${curso.mesInicio} - ${curso.mesTermino} | ${curso.horario}</p>
                </div>
                <button onclick="eliminarCursoOficial('${curso.id}', '${curso.nombre}')" class="btn-outline-danger" title="Eliminar Curso Completamente"><i class="fas fa-trash"></i></button>
            </div>`;
    });
}

async function eliminarCursoOficial(id, nombre) {
    if(await promptActionCustom('Eliminar Curso', `¿Eliminar de raíz el curso "${nombre}"? Se borrará de la lista y de los profesores asignados.`)) {
        if(id !== 'null' && id !== null) {
            await db.collection('cursos').doc(id).delete();
        }
        
        const profesSnap = await db.collection('usuarios').where('rol', '==', 'profesor').get();
        const batch = db.batch();
        profesSnap.forEach(doc => {
            const cursosArr = doc.data().cursos || [];
            if(cursosArr.includes(nombre)) {
                batch.update(doc.ref, { cursos: firebase.firestore.FieldValue.arrayRemove(nombre) });
            }
        });
        await batch.commit();

        showToast('Curso eliminado de raíz', 'success');
        syncGlobalCourses();
    }
}

// ==========================================
// DASHBOARD DEL ALUMNO (PROTEGIDO)
// ==========================================
function renderStudentDashboard() {
    const miNombre = normalizeString(userProfile.nombre);
    
    db.collection('alumnos').get().then(snap => {
        let miAlumnoId = null;
        let miCursoNombre = null;
        
        snap.forEach(d => { 
            if(d.data().nombre && normalizeString(d.data().nombre) === miNombre) {
                miAlumnoId = d.id; 
                miCursoNombre = d.data().curso;
            }
        });
        
        const notasC = document.getElementById('student-notas-list');
        const asistC = document.getElementById('student-asist-list');
        const detallesC = document.getElementById('student-course-details');
        
        if (!miAlumnoId) { 
            detallesC.innerHTML = '<div class="p-3 text-center text-muted"><i class="fas fa-info-circle"></i> No estás vinculado a un curso oficialmente.</div>';
            notasC.innerHTML = '<p class="text-muted text-center"><i class="fas fa-info-circle"></i> Sin datos.</p>'; 
            asistC.innerHTML = '<p class="text-muted text-center"><i class="fas fa-info-circle"></i> Sin datos.</p>'; 
            return; 
        }
        
        const info = globalCoursesData.find(c => c.nombre.trim().toLowerCase() === miCursoNombre.trim().toLowerCase());
        if(info) {
            detallesC.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; padding:20px; gap:15px;">
                    <div>
                        <h2 style="margin:0; color:var(--c-dark); font-weight:900;"><i class="fas fa-graduation-cap" style="color:var(--c-teal);"></i> ${info.nombre}</h2>
                        <p style="margin:5px 0 0 0; color:var(--text-muted); font-size:1.1rem;"><i class="fas fa-user-tie"></i> <b>Profesor(a):</b> ${info.docente}</p>
                    </div>
                    <div style="background:var(--bg-main); padding:15px; border-radius:12px; font-size:0.9rem; color:var(--c-dark); font-weight:700; line-height:1.5; border:1px solid var(--border-light);">
                        <div><i class="fas fa-calendar-alt"></i> <b>Periodo:</b> ${info.mesInicio} a ${info.mesTermino}</div>
                        <div><i class="fas fa-clock"></i> <b>Horario:</b> ${info.horario} (${info.duracion})</div>
                    </div>
                </div>
            `;
        } else {
            detallesC.innerHTML = `<div class="p-3"><h3>Curso: ${miCursoNombre}</h3><p class="text-muted">Detalles adicionales no disponibles.</p></div>`;
        }
        
        db.collection('notas').where('alumnoId', '==', miAlumnoId).onSnapshot(nSnap => {
            notasC.innerHTML = '';
            if (nSnap.empty) { notasC.innerHTML = '<p class="text-muted text-center">Sin calificaciones registradas.</p>'; return; }
            
            let sum = 0; let count = 0; let nHtml = '';
            nSnap.forEach(doc => {
                const n = doc.data(); const val = parseFloat(n.valor); sum += val; count++;
                nHtml += `<div class="student-nota-item"><div><b>${n.tipo || 'Evaluación'}</b><br><small class="text-muted">Fecha: ${formatDateExact(n.fecha)}</small></div><div class="nota-circle ${val>=4?'buena':'mala'}">${val.toFixed(1)}</div></div>`;
            });
            const prom = count > 0 ? (sum/count) : 0;
            const classProm = prom >= 4 ? 'buena' : 'mala';
            
            notasC.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-main); padding:15px; border-radius:12px; margin-bottom:15px; border:1px solid var(--border-light);">
                    <span style="font-weight:900; color:var(--c-dark);">PROMEDIO GENERAL</span>
                    <span class="nota-circle ${classProm}" style="transform:scale(1.1);">${prom.toFixed(1)}</span>
                </div>` + nHtml;
        }, err => console.warn("Error leyendo notas", err));

        db.collection('asistencias').where('alumnoId', '==', miAlumnoId).onSnapshot(aSnap => {
            if (aSnap.empty) { asistC.innerHTML = '<p class="text-muted text-center">Sin registros de asistencia.</p>'; return; }
            let total = 0; let presentes = 0;
            aSnap.forEach(doc => { total++; if(doc.data().estado === 'Presente' || doc.data().estado === 'Justificado') presentes++; });
            const perc = total > 0 ? Math.round((presentes/total)*100) : 0;
            const color = perc >= 85 ? 'var(--success)' : 'var(--danger)';
            const textMsg = perc >= 85 ? 'Asistencia Suficiente' : 'Riesgo de Reprobación';
            
            asistC.innerHTML = `
                <div style="text-align:center; padding:20px;">
                    <div style="font-size:3.5rem; font-weight:900; color:${color}; line-height:1;">${perc}%</div>
                    <p style="font-weight:800; color:var(--c-dark); margin-top:10px; font-size:1.1rem;">${textMsg}</p>
                    <p style="font-size:0.85rem; color:var(--text-muted); margin-top:5px;">Mínimo requerido para aprobar: 85%</p>
                    <div style="display:flex; justify-content:center; gap:20px; margin-top:20px; background:var(--bg-main); padding:10px; border-radius:8px;">
                        <span><b style="color:var(--text-muted);">Total Clases:</b> ${total}</span>
                        <span><b style="color:var(--c-teal);">Asistidas/Just:</b> ${presentes}</span>
                    </div>
                </div>`;
        }, err => console.warn("Error leyendo asistencia", err));

    }).catch(err => {
        console.error("Error al buscar el perfil de estudiante", err);
    });
}

// ==========================================
// COMUNICACIONES CON PRIVACIDAD ABSOLUTA
// ==========================================
function loadMessages(isAlumno) {
    const comboDest = document.getElementById('obs-destinatario');
    const comboTipo = document.getElementById('obs-tipo');
    
    if (isAlumno && comboTipo) {
        comboTipo.innerHTML = `<option value="Consulta">❓ Consulta</option><option value="Aviso Interno">📢 Aviso Interno</option><option value="Solicitud">📄 Solicitud</option><option value="Recordatorio">⏰ Recordatorio</option>`;
    } else if(comboTipo) {
        comboTipo.innerHTML = `<option value="Informativo">📢 Informativo (General)</option><option value="Retroalimentacion">🎯 Retroalimentación (Privada a Alumno)</option><option value="Material">📚 Material de Estudio</option><option value="Reunion">👥 Citación a Reunión</option><option value="Urgente">🚨 Urgente</option>`;
    }

    if (comboDest) {
        db.collection('usuarios').get().then(uSnap => {
            comboDest.innerHTML = '';
            if (!isAlumno) comboDest.innerHTML += '<option value="todos">📢 A Todos los Usuarios</option>';
            
            uSnap.forEach(u => {
                const data = u.data();
                if (u.id !== userProfile.uid) { 
                    if (isAlumno) {
                        if (data.rol.toLowerCase().includes('admin')) {
                            comboDest.innerHTML += `<option value="${u.id}">🛡️ Dirección (${data.nombre})</option>`;
                        } else if (data.rol.toLowerCase() === 'profesor') {
                            comboDest.innerHTML += `<option value="${u.id}">👨‍🏫 Profesor: ${data.nombre}</option>`;
                        }
                    } else {
                        let icon = '👤'; if (data.rol === 'alumno') icon = '🎓'; if (data.rol === 'profesor') icon = '👨‍🏫'; if (data.rol.toLowerCase().includes('admin')) icon = '🛡️';
                        comboDest.innerHTML += `<option value="${u.id}">${icon} ${data.nombre} (${data.rol.toUpperCase()})</option>`;
                    }
                }
            });
        }).catch(err => console.warn("Aviso: Fallo lectura de combo usuarios", err));
    }

    db.collection('comunicaciones').orderBy('fecha', 'desc').onSnapshot(snap => {
        const c = document.getElementById('messages-list'); const cAlumno = document.getElementById('student-avisos-list');
        if(c) c.innerHTML = ''; if(cAlumno) cAlumno.innerHTML = '';
        let unread = 0;
        
        snap.forEach(doc => {
            const m = doc.data();
            
            const eliminados = m.eliminadosPor || [];
            if(eliminados.includes(userProfile.uid)) return;

            const loEnvieYo = m.remitenteUid === userProfile.uid;
            let esParaMiDirecto = false;
            if(m.destinatario === userProfile.uid) esParaMiDirecto = true;
            if(userProfile.rol.toLowerCase().includes('admin') && m.destinatario === 'admin') esParaMiDirecto = true;
            
            const esParaTodos = m.destinatario === 'todos';
            
            if (loEnvieYo || esParaMiDirecto || esParaTodos) {
                
                const readArray = m.leidos || [];
                const isLegacyRead = (m.leido === true || m.leido === "true");
                const yoLoLei = readArray.includes(userProfile.uid) || isLegacyRead;
                
                if((esParaMiDirecto || esParaTodos) && !yoLoLei && !loEnvieYo) unread++;
                
                let badge = 'badge-info';
                if(m.tipo==='Urgente') badge='badge-urgent'; if(m.tipo==='Retroalimentacion') badge='badge-retro';
                if(m.tipo==='Material') badge='badge-material'; if(m.tipo==='Reunion') badge='badge-reunion';
                if(m.tipo==='Consulta' || m.tipo==='Solicitud') badge='badge-consulta';
                
                const actions = [];
                if (!loEnvieYo && (esParaMiDirecto || esParaTodos)) {
                    if (!yoLoLei) actions.push(`<button class="btn-text-action" style="color:var(--c-teal);" onclick="marcarVisto('${doc.id}')"><i class="fas fa-check-double"></i> Visto</button>`);
                    if (!esParaTodos) actions.push(`<button class="btn-text-action" onclick="responderMsg('${m.remitenteUid}', '${m.remitente}', '${doc.id}')"><i class="fas fa-reply"></i> Responder</button>`);
                }
                
                if (loEnvieYo) actions.push(`<button class="btn-text-action" onclick="editarMsg('${doc.id}', \`${m.mensaje}\`)"><i class="fas fa-edit"></i> Editar</button>`);
                
                const isHardDelete = (userProfile.rol.toLowerCase().includes('admin') || loEnvieYo);
                if(isHardDelete) {
                    actions.push(`<button class="btn-text-action delete" onclick="eliminarMsg('${doc.id}', true)"><i class="fas fa-trash"></i> Eliminar</button>`);
                } else {
                    actions.push(`<button class="btn-text-action delete" onclick="eliminarMsg('${doc.id}', false)"><i class="fas fa-eye-slash"></i> Ocultar</button>`);
                }
                
                const readIcon = (loEnvieYo && isLegacyRead && !esParaTodos) ? '<i class="fas fa-check-double" style="color:var(--c-teal); font-size:0.7rem; margin-left:5px;" title="Visto por destinatario"></i>' : '';
                
                const html = `
                    <div class="msg-item ${(!yoLoLei && !loEnvieYo) ? 'unread' : ''}" id="msg-${doc.id}">
                        <div class="msg-meta">
                            <b><i class="fas fa-user-circle" style="color:var(--c-blue-accent)"></i> ${m.remitente} ${readIcon}</b>
                            <div><span style="font-size:0.75rem; color:var(--text-muted); margin-right:10px;">${formatDateExact(m.fecha)}</span><span class="badge-msg ${badge}">${m.tipo}</span></div>
                        </div>
                        <p class="text-sm mt-2" style="font-weight:700; color:var(--text-main);">${m.mensaje}</p>
                        <div class="msg-actions">${actions.join('')}</div>
                    </div>`;
                
                if(c) c.innerHTML += html; 
                if(cAlumno && (esParaMiDirecto || esParaTodos)) cAlumno.innerHTML += html;
            }
        });
        
        const b = document.getElementById('msg-badge'); if(b) { b.textContent = unread; b.style.display = unread > 0 ? 'inline-block' : 'none'; }
    }, err => console.warn("Aviso en listener de mensajes: ", err));
}

async function sendObservation() {
    const d = document.getElementById('obs-destinatario').value; const t = document.getElementById('obs-tipo').value; const m = document.getElementById('obs-texto').value.trim();
    if (!m) return showToast('Escribe un mensaje', 'warning');
    await db.collection('comunicaciones').add({ remitente: userProfile.nombre, remitenteUid: userProfile.uid, destinatario: d, tipo: t, mensaje: m, fecha: new Date(), leido: false, leidos: [], eliminadosPor: [] });
    document.getElementById('obs-texto').value = ''; showToast('Mensaje enviado');
}

async function marcarVisto(id) { 
    try {
        await db.collection('comunicaciones').doc(id).set({
            leidos: firebase.firestore.FieldValue.arrayUnion(userProfile.uid)
        }, { merge: true }); 
        const msgDiv = document.getElementById(`msg-${id}`);
        if (msgDiv) msgDiv.classList.remove('unread');
    } catch(e) { console.error(e); }
}

async function eliminarMsg(id, isHardDelete) { 
    if(await promptActionCustom('Eliminar', '¿Borrar mensaje de tu bandeja?')) {
        try {
            if(isHardDelete) {
                await db.collection('comunicaciones').doc(id).delete(); 
            } else {
                await db.collection('comunicaciones').doc(id).set({
                    eliminadosPor: firebase.firestore.FieldValue.arrayUnion(userProfile.uid)
                }, { merge: true });
            }
            showToast('Mensaje eliminado');
        } catch(e) { console.error(e); showToast('Aviso: Permisos de Firestore limitados.', 'error'); }
    }
}

async function responderMsg(uid, nombre, originalMsgId) {
    const r = await promptActionCustom(`Responder a ${nombre}`, 'Escribe tu respuesta:', true, 'Mensaje...');
    if(r) { 
        await db.collection('comunicaciones').add({ remitente: userProfile.nombre, remitenteUid: userProfile.uid, destinatario: uid, tipo: 'Aviso Interno', mensaje: "RE: " + r, fecha: new Date(), leido: false, leidos: [], eliminadosPor: [] }); 
        await db.collection('comunicaciones').doc(originalMsgId).set({
            leidos: firebase.firestore.FieldValue.arrayUnion(userProfile.uid)
        }, { merge: true }); 
        showToast('Respuesta enviada y mensaje marcado como visto'); 
    }
}

async function editarMsg(id, oldMsg) {
    const m = await promptActionCustom('Editar Mensaje', 'Modifica tu mensaje:', true, oldMsg);
    if(m) { await db.collection('comunicaciones').doc(id).update({mensaje: m}); showToast('Mensaje actualizado'); }
}

// ==========================================
// ASISTENCIA Y SUSPENSIÓN 
// ==========================================
async function renderAttendanceList() {
    if (!lockedCourse) return;
    const fecha = document.getElementById('asist-fecha').value; const c = document.getElementById('asist-list-container');
    if (!fecha) return;
    
    let isSuspended = false; let suspMotivo = "";
    try {
        const susp = await db.collection('suspensiones').doc(`${lockedCourse}_${fecha}`).get();
        if(susp.exists) { isSuspended = true; suspMotivo = susp.data().motivo; }
    } catch(e) { console.warn("Continuando sin chequear suspensión."); }
    
    if(isSuspended) {
        c.innerHTML = `<div class="banner-suspendido"><i class="fas fa-exclamation-triangle" style="font-size:3rem; margin-bottom:10px;"></i><h3>CLASE SUSPENDIDA</h3><p><b>Motivo:</b> ${suspMotivo}</p></div>`;
        return;
    }
    
    const alumnos = await getAlumnosDelCurso(lockedCourse);
    if(alumnos.length === 0){ c.innerHTML = '<p class="text-muted text-center">No hay alumnos en la lista de este curso.</p>'; return;}

    const aSnap = await db.collection('asistencias').where('curso','==',lockedCourse).where('fecha','==',fecha).get();
    let map = {}; aSnap.forEach(d => map[d.data().alumnoId] = d.data().estado);
    
    let html = '<table class="edu-table"><thead><tr><th>Nombre del Estudiante</th><th style="text-align:right;">Estado</th></tr></thead><tbody>';
    let p=0, a=0, j=0;
    
    const isAdmin = userProfile.rol.toLowerCase().includes('admin');

    alumnos.sort((x,y)=>x.nombre.localeCompare(y.nombre)).forEach(al => {
        const e = map[al.id];
        if(e==='Presente') p++; if(e==='Ausente') a++; if(e==='Justificado') j++;
        
        const delBtn = isAdmin ? `<button onclick="eliminarAlumno('${al.id}', '${al.nombre}')" style="background:none; border:none; color:var(--danger); cursor:pointer; margin-left:10px; font-size:1.1rem;" title="Eliminar Alumno Definitivamente"><i class="fas fa-user-times"></i></button>` : '';
        
        html += `<tr><td><b>${al.nombre}</b> ${delBtn}</td><td style="text-align:right;">
            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button onclick="setAsist('${al.id}','Presente')" class="btn-mini-asist p ${e==='Presente'?'active':''}" title="Presente">P</button>
                <button onclick="setAsist('${al.id}','Ausente')" class="btn-mini-asist a ${e==='Ausente'?'active':''}" title="Ausente">A</button>
                <button onclick="setAsist('${al.id}','Justificado')" class="btn-mini-asist j ${e==='Justificado'?'active':''}" title="Justificado">J</button>
            </div>
        </td></tr>`;
    });
    c.innerHTML = `<div style="display:flex; justify-content:space-around; background:var(--bg-white); padding:10px; border-radius:8px; margin-bottom:15px; border:1px solid var(--border-light);"><span><b>Presentes:</b> <span style="color:var(--success)">${p}</span></span><span><b>Ausentes:</b> <span style="color:var(--danger)">${a}</span></span><span><b>Justificados:</b> <span style="color:var(--warning)">${j}</span></span></div>` + html + '</tbody></table>';
}

async function setAsist(alumnoId, estado) {
    if (!lockedCourse) return;
    const f = document.getElementById('asist-fecha').value;
    const q = await db.collection('asistencias').where('alumnoId','==',alumnoId).where('fecha','==',f).get();
    if (!q.empty) await db.collection('asistencias').doc(q.docs[0].id).update({ estado });
    else await db.collection('asistencias').add({ alumnoId, curso:lockedCourse, fecha:f, estado, profesor: userProfile.nombre });
    renderAttendanceList();
}

async function suspenderClase() {
    if(!lockedCourse) return showToast('Seleccione un curso del Dashboard.', 'warning');
    const f = document.getElementById('asist-fecha').value;
    if(!f) return showToast('Seleccione la fecha.', 'warning');
    
    const motivo = await promptActionCustom('Suspender Clase', `Motivo de suspensión para ${lockedCourse} el ${f}:`, true, 'Ej: Feriado legal');
    if(motivo) {
        try { await db.collection('suspensiones').doc(`${lockedCourse}_${f}`).set({ motivo, fecha: f, curso: lockedCourse, admin: userProfile.nombre }); } 
        catch(e) { showToast('Aviso: Debes actualizar las reglas de Firestore.', 'error'); return;}
        
        await db.collection('bitacoras').add({ curso: lockedCourse, fecha: f, tipo: 'Suspendida', contenido: `Clase suspendida. Motivo: ${motivo}`, profesor: userProfile.nombre, createdAt: new Date() });
        showToast('Clase suspendida oficialmente'); renderAttendanceList();
    }
}

// ==========================================
// NOTAS Y ELIMINAR ALUMNOS
// ==========================================
async function renderNotesList() {
    if (!lockedCourse) return;
    const c = document.getElementById('notes-table-container');
    const isAdmin = userProfile.rol.toLowerCase().includes('admin');
    
    const alumnos = await getAlumnosDelCurso(lockedCourse);
    if(alumnos.length === 0){ c.innerHTML = '<p class="text-muted text-center">No hay alumnos registrados en este curso.</p>'; return;}
    
    let html = '<table class="edu-table"><thead><tr><th>Estudiante</th><th>Calificaciones</th><th style="text-align:right">Promedio Final</th></tr></thead><tbody>';
    alumnos.sort((a,b)=>a.nombre.localeCompare(b.nombre)).forEach(al => {
        const delBtn = isAdmin ? `<button onclick="eliminarAlumno('${al.id}', '${al.nombre}')" style="background:none; border:none; color:var(--danger); cursor:pointer; margin-left:10px; font-size:1.1rem;" title="Eliminar Alumno Definitivamente"><i class="fas fa-user-times"></i></button>` : '';

        html += `<tr id="row-${al.id}"><td><b>${al.nombre}</b> ${delBtn}</td><td><div id="notas-${al.id}" style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;"></div></td><td style="text-align:right" id="prom-${al.id}">-</td></tr>`;
        
        db.collection('notas').where('alumnoId','==',al.id).onSnapshot(nSnap => {
            let nHtml = ''; let sum = 0; let count = 0;
            nSnap.forEach(n => {
                const val = parseFloat(n.data().valor); sum += val; count++;
                let deleteNoteClick = '';
                if(!isAdmin) deleteNoteClick = `onclick="deleteNote('${n.id}')" style="cursor:pointer;" title="Clic para borrar"`;
                nHtml += `<span class="note-cell ${val<4?'danger':'success'}" ${deleteNoteClick}>${val.toFixed(1)}</span>`;
            });
            
            if(!isAdmin) {
                nHtml += `
                <div style="display:inline-flex; align-items:center; gap:5px; margin-bottom:5px;">
                    <input type="text" inputmode="decimal" id="input-nota-${al.id}" style="width:55px; padding:6px; border-radius:8px; border:2px dashed var(--c-blue-accent); text-align:center; font-weight:800; outline:none;" placeholder="+" onkeydown="if(event.key==='Enter') saveNote('${al.id}', this)">
                    <button onclick="saveNote('${al.id}', document.getElementById('input-nota-${al.id}'))" style="background:var(--c-teal); color:white; border:none; width:32px; height:32px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow-sm);" title="Guardar Nota">
                        <i class="fas fa-check"></i>
                    </button>
                </div>`;
            }
            document.getElementById(`notas-${al.id}`).innerHTML = nHtml;
            
            const prom = count > 0 ? (sum/count) : 0;
            const badgeColor = prom >= 4 ? 'var(--success)' : (prom > 0 ? 'var(--danger)' : 'var(--border-light)');
            document.getElementById(`prom-${al.id}`).innerHTML = `<span class="promedio-badge" style="background:${badgeColor}">${prom>0 ? prom.toFixed(1) : '-'}</span>`;
        });
    });
    c.innerHTML = html + '</tbody></table>';
}

async function saveNote(alumnoId, inputEl) {
    const val = parseFloat(inputEl.value.replace(',', '.'));
    if (!isNaN(val) && val >= 1.0 && val <= 7.0) {
        inputEl.disabled = true;
        await db.collection('notas').add({ alumnoId, valor: val, fecha: new Date(), tipo: 'Evaluación' });
    } else { showToast('Nota entre 1 y 7', 'error'); inputEl.value = ''; }
}
async function deleteNote(id) { if(await promptActionCustom('Borrar', '¿Eliminar calificación?')) await db.collection('notas').doc(id).delete(); }

async function eliminarAlumno(alumnoId, nombreAlumno) {
    if(await promptActionCustom('Eliminar Alumno', `¿Estás seguro de eliminar a ${nombreAlumno} del curso ${lockedCourse}? Se borrarán TODAS sus notas y asistencia en el sistema.`)) {
        const batch = db.batch();
        const nSnap = await db.collection('notas').where('alumnoId', '==', alumnoId).get();
        nSnap.forEach(doc => batch.delete(doc.ref));
        
        const aSnap = await db.collection('asistencias').where('alumnoId', '==', alumnoId).get();
        aSnap.forEach(doc => batch.delete(doc.ref));
        
        batch.delete(db.collection('alumnos').doc(alumnoId));
        
        const uSnap = await db.collection('usuarios').where('nombre', '==', nombreAlumno).where('rol', '==', 'alumno').get();
        uSnap.forEach(doc => batch.delete(doc.ref));
        
        try {
            await batch.commit();
            showToast('Alumno retirado correctamente', 'success');
            renderNotesList(); renderAttendanceList();
        } catch(e) {
            showToast('Error de permisos en Base de Datos.', 'error');
        }
    }
}

// ==========================================
// EXPORTAR REPORTES CSV E INFORMES PDF
// ==========================================
function downloadCSV(csv, filename) {
    let blob = new Blob(["\uFEFF"+csv], { type: 'text/csv;charset=utf-8;' }); 
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = filename; link.click();
}

async function exportarAsistencia() {
    if(!lockedCourse) return showToast('Fije un curso del Dashboard', 'warning');
    const f = document.getElementById('asist-fecha').value;
    if(!f) return showToast('Seleccione fecha', 'warning');
    let csv = `REPORTE DE ASISTENCIA\nCurso:,${lockedCourse}\nFecha:,${f}\n\nALUMNO,ESTADO\n`;
    const alumnos = await getAlumnosDelCurso(lockedCourse);
    const asistSnap = await db.collection('asistencias').where('curso','==',lockedCourse).where('fecha','==',f).get();
    let map = {}; asistSnap.forEach(d => map[d.data().alumnoId] = d.data().estado || 'No Registrado');
    alumnos.forEach(doc => { csv += `"${doc.nombre}",${map[doc.id] || 'No Registrado'}\n`; });
    downloadCSV(csv, `Asistencia_${lockedCourse}_${f}.csv`);
}

async function exportarNotas() {
    if(!lockedCourse) return showToast('Fije un curso del Dashboard', 'warning');
    let csv = `REPORTE DE CALIFICACIONES\nCurso:,${lockedCourse}\n\nALUMNO,PROMEDIO,NOTAS\n`;
    const alumnos = await getAlumnosDelCurso(lockedCourse);
    for (let doc of alumnos) {
        const notasSnap = await db.collection('notas').where('alumnoId','==',doc.id).get();
        let sum = 0; let count = 0; let notasArr = [];
        notasSnap.forEach(n => { const v = parseFloat(n.data().valor); sum+=v; count++; notasArr.push(v.toFixed(1)); });
        const prom = count > 0 ? (sum/count).toFixed(1) : 'Sin notas';
        csv += `"${doc.nombre}",${prom},"${notasArr.join(' - ')}"\n`;
    }
    downloadCSV(csv, `Notas_${lockedCourse}.csv`);
}

async function generarReporteOficial(tipo) {
    if(!lockedCourse) return showToast('Primero fije un curso haciendo clic en una tarjeta de la pestaña "Inicio".', 'warning');
    const cursoNombre = lockedCourse;

    const cursoInfo = globalCoursesData.find(c => c.nombre === cursoNombre) || {
        docente: 'No definido', mesInicio: '-', mesTermino: '-', horario: '-'
    };

    const alumnos = await getAlumnosDelCurso(cursoNombre);
    alumnos.sort((a,b)=>a.nombre.localeCompare(b.nombre));

    let tableHTML = '';

    if (tipo === 'notas') {
        tableHTML = '<table><thead><tr><th>Alumno</th><th>Notas</th><th>Promedio</th></tr></thead><tbody>';
        for (let al of alumnos) {
            const nSnap = await db.collection('notas').where('alumnoId','==',al.id).get();
            let sum=0, count=0; let notasStr = [];
            nSnap.forEach(n=>{ const v = parseFloat(n.data().valor); sum+=v; count++; notasStr.push(v.toFixed(1)); });
            const prom = count > 0 ? (sum/count).toFixed(1) : '-';
            tableHTML += `<tr><td>${al.nombre}</td><td>${notasStr.join(', ')}</td><td><b>${prom}</b></td></tr>`;
        }
        tableHTML += '</tbody></table>';
    } else {
        tableHTML = '<table><thead><tr><th>Alumno</th><th>Asistencias</th><th>Ausencias</th><th>Justificados</th><th>% Asistencia</th></tr></thead><tbody>';
        for (let al of alumnos) {
            const aSnap = await db.collection('asistencias').where('curso','==',cursoNombre).where('alumnoId','==',al.id).get();
            let p=0, a=0, j=0, total=0;
            aSnap.forEach(doc=>{
                total++;
                const e=doc.data().estado;
                if(e==='Presente')p++; else if(e==='Ausente')a++; else if(e==='Justificado')j++;
            });
            const perc = total>0 ? Math.round(((p+j)/total)*100) : 0;
            tableHTML += `<tr><td>${al.nombre}</td><td>${p}</td><td>${a}</td><td>${j}</td><td><b>${perc}%</b></td></tr>`;
        }
        tableHTML += '</tbody></table>';
    }

    // Obtenemos la ruta absoluta de tu servidor para el logo
    const currentPath = window.location.href.split('?')[0].split('#')[0];
    const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));
    const logoUrl = basePath + '/logo.png';

    // ABRIMOS LA VENTA DE VISTA PREVIA RESPONSIVA (DISEÑO INTACTO)
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Vista Previa - Reporte ${cursoNombre}</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 0; padding: 0; background: #e2e8f0; }
                
                /* BARRA DE CONTROLES NO IMPRIMIBLE */
                .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 15px 20px; position: sticky; top: 0; z-index: 1000; box-shadow: 0 4px 6px rgba(0,0,0,0.1); flex-wrap: wrap; gap: 10px;}
                .no-print-bar h3 { margin: 0; color: white; font-size: 1.1rem; }
                .action-btns { display: flex; gap: 10px; flex-wrap: wrap;}
                .btn-pv { padding: 10px 15px; font-size: 1rem; font-weight: bold; border: none; border-radius: 8px; cursor: pointer; transition: 0.2s; display:flex; align-items:center; gap:5px;}
                .btn-print { background: #00a89d; color: white; }
                .btn-print:hover { background: #008f85; }
                .btn-close { background: #ef4444; color: white; }
                .btn-close:hover { background: #dc2626; }

                /* HOJA DE REPORTE */
                .page-container { background: white; max-width: 900px; margin: 30px auto; padding: 40px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); border-radius: 8px; }
                
                /* ESTILOS INTERNOS DEL REPORTE */
                .header { display: flex; align-items: center; border-bottom: 3px solid #00a89d; padding-bottom: 20px; margin-bottom: 30px; flex-wrap: wrap; gap: 20px; }
                .header img { height: 70px; object-fit: contain; }
                .header-text h1 { margin: 0; color: #002855; font-size: 22px; text-transform: uppercase; }
                .header-text h2 { margin: 5px 0 0 0; color: #b92b82; font-size: 16px; }
                .info-box { background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 30px; border: 1px solid #e2e8f0; display:flex; flex-wrap: wrap; gap: 20px; }
                .info-item { flex: 1; min-width: 150px; }
                .info-item strong { display: block; font-size: 12px; color: #64748b; text-transform: uppercase; margin-bottom: 4px; }
                .info-item span { font-size: 15px; color: #1e293b; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #cbd5e1; padding: 12px; text-align: left; }
                th { background-color: #00a89d; color: white; text-transform: uppercase; font-size: 12px; }
                td { font-size: 14px; text-transform: uppercase; }
                tr:nth-child(even) { background-color: #f8fafc; }
                .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }

                /* RESPONSIVO PARA CELULARES Y TABLETS EN PANTALLA */
                @media (max-width: 768px) {
                    .page-container { margin: 10px; padding: 20px; }
                    .header img { height: 50px; }
                    .header-text h1 { font-size: 18px; }
                    th, td { font-size: 12px; padding: 8px; }
                }

                /* ESTILOS ESPECÍFICOS PARA LA IMPRESIÓN (PDF o FÍSICO) */
                @media print {
                    .no-print-bar { display: none !important; }
                    body { background: white; }
                    .page-container { margin: 0; padding: 0; box-shadow: none; max-width: 100%; border-radius: 0; }
                }
            </style>
        </head>
        <body>
            <div class="no-print-bar">
                <h3>📄 Vista Previa de Documento</h3>
                <div class="action-btns">
                    <button class="btn-pv btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
                    <button class="btn-pv btn-close" onclick="window.close()">❌ Cerrar</button>
                </div>
            </div>

            <div class="page-container">
                <div class="header">
                    <img src="${logoUrl}" alt="Logo" onerror="this.style.display='none'">
                    <div class="header-text">
                        <h1>Centro de Capacitación</h1>
                        <h2>Informe Oficial de ${tipo === 'notas' ? 'Calificaciones' : 'Asistencia'}</h2>
                    </div>
                </div>
                <div class="info-box">
                    <div class="info-item"><strong>Curso</strong><span>${cursoNombre}</span></div>
                    <div class="info-item"><strong>Docente</strong><span>${cursoInfo.docente}</span></div>
                    <div class="info-item"><strong>Periodo</strong><span>${cursoInfo.mesInicio} - ${cursoInfo.mesTermino}</span></div>
                    <div class="info-item"><strong>Horario</strong><span>${cursoInfo.horario}</span></div>
                </div>
                ${tableHTML}
                <div class="footer">Documento oficial - Sistema de Gestión Académica - ${new Date().toLocaleDateString('es-CL')}</div>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// ==========================================
// BITÁCORA Y ADMIN
// ==========================================
async function saveBitacora() {
    if (!lockedCourse) return showToast('Fije un curso primero.', 'warning');
    const f = document.getElementById('mat-fecha').value; const t = document.getElementById('mat-tipo').value; const msg = document.getElementById('mat-contenido').value.trim();
    if (!f || !msg) return showToast('Faltan datos', 'warning');
    await db.collection('bitacoras').add({ curso:lockedCourse, fecha:f, tipo:t, contenido:msg, profesor: userProfile.nombre, createdAt: new Date() });
    document.getElementById('mat-contenido').value = ''; showToast('Guardado');
}

function loadBitacora() {
    const filtro = document.getElementById('filtro-bitacora-admin') ? document.getElementById('filtro-bitacora-admin').value : 'todas';
    let q = db.collection('bitacoras').orderBy('createdAt', 'desc');
    if (filtro === 'Suspendida') q = q.where('tipo', '==', 'Suspendida');
    
    q.onSnapshot(snap => {
        const c = document.getElementById('bitacora-list-filtro'); if(!c) return; c.innerHTML = '';
        snap.forEach(doc => {
            const b = doc.data();
            if(lockedCourse && b.curso !== lockedCourse) return;
            const color = b.tipo === 'Suspendida' ? 'var(--warning)' : 'var(--c-teal)';
            c.innerHTML += `<div style="padding:15px; border-left:4px solid ${color}; background:var(--bg-white); margin-bottom:10px; border-radius:8px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; justify-content:space-between;">
                    <small style="color:var(--text-muted)"><b>${b.fecha}</b> | ${b.curso} | ${b.tipo}</small>
                    <b style="color:var(--c-dark); font-size:0.8rem;"><i class="fas fa-user-tie"></i> ${b.profesor}</b>
                </div>
                <p style="margin-top:8px; font-weight:600;">${b.contenido}</p>
            </div>`;
        });
    });
}

function loadAdminData() {
    db.collection('usuarios').where('rol', '==', 'profesor').onSnapshot(snap => {
        const c = document.getElementById('admin-docentes-list'); if(!c) return; c.innerHTML = '';
        snap.forEach(doc => {
            const p = doc.data(); const cTxt = p.cursos ? p.cursos.join(', ') : 'Ninguno';
            c.innerHTML += `<div class="admin-prof-card"><div class="prof-info"><h4><i class="fas fa-chalkboard-teacher"></i> ${p.nombre}</h4><p>Cursos: ${cTxt}</p></div>
                <div class="admin-actions">
                    <button onclick="agregarNuevoCursoExistente('${doc.id}', '${p.nombre}')" class="btn-outline-teal" title="Añadir curso"><i class="fas fa-plus"></i></button>
                    <button onclick="eliminarDocente('${doc.id}', '${p.nombre}')" class="btn-outline-danger" title="Retirar docente"><i class="fas fa-trash"></i></button>
                </div></div>`;
        });
    });
}

async function agregarNuevoCursoExistente(docId, nombreProfe) {
    const c = await promptActionCustom('Añadir Curso', `Escribe el curso para ${nombreProfe}:`, true, 'Ej: Excel Básico');
    if (c) { 
        await db.collection('usuarios').doc(docId).update({ cursos: firebase.firestore.FieldValue.arrayUnion(c.trim()) }); 
        showToast('Curso añadido');
        if(userProfile.rol.toLowerCase().includes('admin')) syncGlobalCourses();
    }
}

async function eliminarDocente(docId, nombreProfe) {
    if(await promptActionCustom('Retirar Docente', `¿Eliminar a ${nombreProfe} permanentemente?`)) { await db.collection('usuarios').doc(docId).delete(); showToast('Eliminado'); }
}

async function registerUserSystem() {
    const rol = document.getElementById('adm-nuevo-rol').value; 
    const nombre = document.getElementById('adm-prof-name').value.trim(); 
    const user = document.getElementById('adm-prof-user').value.trim().toLowerCase(); 
    const pass = document.getElementById('adm-prof-pass').value; 
    
    let curso = "";
    if(rol !== 'admin') {
        const selVal = document.getElementById('adm-prof-curso-select').value;
        if(selVal === 'NUEVO') curso = document.getElementById('adm-prof-nuevo-curso').value.trim();
        else curso = selVal;
    }
    
    if(!nombre || !user || !pass) return showToast('Datos incompletos', 'warning');
    if(rol !== 'admin' && !curso) return showToast('Asigna un curso', 'warning');
    
    try {
        const cr = await secondaryApp.auth().createUserWithEmailAndPassword(user + '@capa.local', pass);
        await db.collection('usuarios').doc(cr.user.uid).set({ nombre, rol, usuario: user, cursos: curso ? curso.split(',').map(c=>c.trim()) : [] });
        
        if (rol === 'alumno' && curso) {
            await db.collection('alumnos').add({ nombre: nombre.toUpperCase(), curso: curso });
        }
        
        await secondaryApp.auth().signOut(); showToast('Usuario creado con éxito'); 
        document.querySelectorAll('#adm-prof-name, #adm-prof-user, #adm-prof-pass, #adm-prof-nuevo-curso').forEach(el=>el.value='');
        document.getElementById('adm-prof-curso-select').value = '';
        document.getElementById('adm-prof-nuevo-curso').classList.add('hidden');
    } catch(e) { 
        if(e.code === 'auth/email-already-in-use') showToast('Ese usuario ya existe.', 'error');
        else showToast('Error: ' + e.message, 'error'); 
    }
}

async function bulkUpload() {
    let c = lockedCourse;
    if(!c) return showToast('Fija un curso en el Inicio primero.', 'warning');

    const listRaw = document.getElementById('bulk-list').value;
    const list = listRaw.split('\n').map(n => n.trim()).filter(n => n !== "");
    
    if (list.length === 0) return showToast('La lista está vacía', 'error');
    showToast('Iniciando carga masiva con cuentas...', 'info');
    
    let count = 0;
    for(let nombre of list) {
        let emailBase = nombre.toLowerCase().replace(/\s+/g, '.').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        let email = emailBase + '@capa.local';
        let pass = 'capa2026';

        try {
            const cr = await secondaryApp.auth().createUserWithEmailAndPassword(email, pass);
            await db.collection('usuarios').doc(cr.user.uid).set({ nombre: nombre.toUpperCase(), rol: 'alumno', usuario: emailBase, cursos: [c] });
            await db.collection('alumnos').add({ nombre: nombre.toUpperCase(), curso: c });
            await secondaryApp.auth().signOut();
            count++;
        } catch(e) {
            if(e.code === 'auth/email-already-in-use') {
                let rnd = Math.floor(Math.random() * 1000);
                try {
                    const cr2 = await secondaryApp.auth().createUserWithEmailAndPassword(emailBase + rnd + '@capa.local', pass);
                    await db.collection('usuarios').doc(cr2.user.uid).set({ nombre: nombre.toUpperCase(), rol: 'alumno', usuario: emailBase + rnd, cursos: [c] });
                    await db.collection('alumnos').add({ nombre: nombre.toUpperCase(), curso: c });
                    await secondaryApp.auth().signOut();
                    count++;
                } catch(ex) { console.error(ex); }
            }
        }
    }
    
    showToast(count + ' alumnos matriculados con cuentas web', 'success'); 
    document.getElementById('bulk-list').value = '';
}