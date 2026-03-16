// CADA VEZ QUE HAGAS CAMBIOS GRANDES, CAMBIA ESTE NÚMERO (v3, v4, v5...)
const CACHE_NAME = 'capa-limache-v7'; 

const urlsToCache = [
  './',
  './index.html',
  './styles.css?v=7',
  './app.js?v=7',
  './logo.png'
];

// Instala el nuevo Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // Fuerza a que se active de inmediato
});

// Borra la memoria caché vieja para hacer espacio a la nueva
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Borrando caché antigua:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim(); // Toma el control de la pantalla al instante
});

// Estrategia: Buscar en Internet primero, si falla, usar la Caché
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});