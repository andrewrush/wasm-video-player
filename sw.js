// Service Worker for WASM Video Player
const CACHE_NAME = 'wasm-video-player-v3';
const FILES_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/webgl-filters.js',
    './js/ffmpeg/ffmpeg.js',
    './js/ffmpeg/814.ffmpeg.js'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(names => 
            Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(response => {
            if (response) return response;
            return fetch(e.request).catch(() => {
                if (e.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
