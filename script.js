// ===== Utilities =====
lightboxIndex = startIndex;
const set = items;
function show(i) {
lightboxIndex = (i + set.length) % set.length;
lightboxImg.src = set[lightboxIndex].url;
lightboxImg.alt = set[lightboxIndex].title;
}
show(lightboxIndex);
lightbox.classList.add('active');
document.body.style.overflow = 'hidden';


const onPrev = () => show(lightboxIndex - 1);
const onNext = () => show(lightboxIndex + 1);
const onKey = (e) => {
if (e.key === 'Escape') closeLightbox();
if (e.key === 'ArrowLeft') onPrev();
if (e.key === 'ArrowRight') onNext();
};


lightboxPrev.onclick = onPrev;
lightboxNext.onclick = onNext;
document.addEventListener('keydown', onKey, { once: true });
}


function closeLightbox() {
lightbox.classList.remove('active');
document.body.style.overflow = '';
}


lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });


// ===== Accessibility: preserve focus outline only via keyboard =====
(function focusVis() {
function handleMouseDownOnce() { document.body.classList.add('using-mouse'); document.removeEventListener('mousedown', handleMouseDownOnce); }
function handleKeyDown(e) { if (e.key === 'Tab') { document.body.classList.remove('using-mouse'); document.addEventListener('mousedown', handleMouseDownOnce, { once: true }); } }
document.addEventListener('keydown', handleKeyDown);
})();
