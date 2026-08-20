const CACHE_NAME = "wheelie-timer-v3";
const FILES = ["./", "./index.html", "./style.css", "./script.js", "./manifest.json"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => event.respondWith(caches.match(event.request).then(response => response || fetch(event.request))));
