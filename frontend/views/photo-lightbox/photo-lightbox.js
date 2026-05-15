// views/photo-lightbox/photo-lightbox.js
import { register } from '../../core/router.js';
import {
    closePhotoLightbox,
    lightboxSetCover,
    lightboxDelete,
} from '../../features/photos/controller.js';

export function init() {
    register('view-photo-lightbox', { element: document.getElementById('view-photo-lightbox') });
    document.getElementById('btn-lightbox-close').onclick = closePhotoLightbox;
    document.getElementById('btn-lightbox-set-cover').onclick = lightboxSetCover;
    document.getElementById('btn-lightbox-delete').onclick = lightboxDelete;
}
