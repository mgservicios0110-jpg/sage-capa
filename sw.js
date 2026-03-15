const CACHE_NAME = 'capa-limache-v1';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './logo.png'
];

// Instalar el Service Worker y guardar en caché los archivos principales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Archivos en caché');
        return cache.addAll(urlsToCache);
      })
  );
});

// Interceptar las peticiones para cargar más rápido
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Si el archivo está en caché, lo devuelve. Si no, lo descarga de internet.
        return response || fetch(event.request);
      })
  );
});