'use strict';

window.FamilyPhotos = {
  create(data, {elem, button, normalise, openSource}) {
    const photos = data.photos || [];
    const people = new Map(data.people.map(person => [person.id, person]));
    const photosByPerson = new Map();
    const avatars = new Map();
    const searchText = new Map();
    const front = photo => photo.sides.find(side => side.side === 'front') || photo.sides[0];
    const dialog = document.getElementById('familyPhotosDialog');
    const galleryBody = document.getElementById('familyPhotosBody');
    const close = document.getElementById('closeFamilyPhotos');
    let disposeGallery = null;

    for (const photo of photos) {
      for (const subject of photo.people) {
        if (!photosByPerson.has(subject.id)) photosByPerson.set(subject.id, []);
        photosByPerson.get(subject.id).push(photo);
        if (photo.people.length > 1 && !subject.avatarPreview && !subject.avatarPosition) continue;
        const rank = subject.avatarPreview ? 3 : subject.avatarPosition || photo.people.length === 1 ? 2 : 1;
        if (!avatars.has(subject.id) || avatars.get(subject.id).rank < rank) {
          avatars.set(subject.id, {
            rank, src:subject.avatarPreview || front(photo).preview, position:subject.avatarPosition,
            sha256:subject.avatarPreviewSha256 || front(photo).previewSha256
          });
        }
      }
      searchText.set(photo.id, normalise([photo.title, photo.description, photo.takenLabel, photo.dateBasis, photo.receivedLabel, photo.cataloguedLabel,
        photo.sender, photo.channel, photo.identification, ...photo.sides.map(side => side.caption),
        ...photo.people.flatMap(subject => [people.get(subject.id)?.name, people.get(subject.id)?.alias, subject.ageLabel, subject.position])
      ].filter(Boolean).join(' ')));
    }

    function avatar(person) {
      const portrait = avatars.get(person.id);
      if (!portrait?.src) return null;
      const image = elem('img', undefined, 'tile-avatar');
      image.alt = '';
      image.width = image.height = 42;
      image.draggable = false;
      image.decoding = 'async';
      image.src = portrait.src;
      if (portrait.sha256) image.dataset.portraitSha256 = portrait.sha256;
      if (portrait.rank === 1) image.classList.add('group-thumbnail');
      if (portrait.position) image.style.objectPosition = portrait.position;
      return image;
    }

    function thumbnail(photo) {
      const image = elem('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = front(photo).preview;
      image.alt = '';
      return image;
    }

    function metadata(photo) {
      const list = elem('dl', undefined, 'family-photo-meta');
      const subjects = photo.people.map(subject => [people.get(subject.id)?.name, subject.position, subject.ageLabel].filter(Boolean).join(' · '));
      const taken = !photo.takenLabel || photo.takenLabel === 'Дата зйомки невідома' ? 'Невідома' : photo.takenLabel;
      const lines = [
        ['На фото', subjects.join('; ')], ['Дата зйомки', [taken,photo.dateBasis].filter(Boolean).join(' · ')],
        ['Відомості про людей', photo.identification], ['Від кого', photo.sender], ['Надіслано', [photo.receivedLabel, photo.channel].filter(Boolean).join(' · ')],
        ['Додано до архіву', !photo.receivedLabel && photo.cataloguedLabel]
      ];
      for (const [label,value] of lines) {
        if (!value) continue;
        const row = elem('div');
        row.append(elem('dt',label),elem('dd',value));
        list.append(row);
      }
      return list;
    }

    function openGallery(entries, title, firstId, trigger) {
      if (!entries.length || dialog.open) return;
      document.getElementById('familyPhotosTitle').textContent = title;
      galleryBody.replaceChildren();
      const controller = new AbortController();
      const urls = [];
      const pending = new Map();
      let observer = null;
      // Load the larger encrypted files as the reader approaches each print.
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(items => {
          for (const item of items) if (item.isIntersecting) {
            observer.unobserve(item.target);
            pending.get(item.target)?.();
            pending.delete(item.target);
          }
        }, {root:galleryBody,rootMargin:'450px 0px'});
      }
      let first;
      for (const photo of entries) {
        const article = elem('article', undefined, 'family-print');
        article.append(elem('h3',photo.title));
        if (photo.id === firstId) first = article;
        for (const side of photo.sides) {
          const figure = elem('figure');
          const image = elem('img');
          const sideLabel = side.side === 'back' ? 'Зворот' : 'Лицьовий бік';
          image.alt = [photo.title, sideLabel, side.caption].filter(Boolean).join('. ');
          image.decoding = 'async';
          const sideways = Math.abs((side.rotation || 0) % 180) === 90;
          if (side.width && side.height) {
            // Reserve the original's upright bounds while the smaller preview is visible.
            image.width = sideways ? side.height : side.width;
            image.height = sideways ? side.width : side.height;
          }
          image.src = side.preview;
          const caption = elem('figcaption', [photo.sides.length > 1 || side.side === 'back' ? sideLabel : '', side.caption].filter(Boolean).join(' · '));
          figure.append(image);
          if (caption.textContent) figure.append(caption);
          const status = elem('div',undefined,'family-photo-status');
          status.setAttribute('role','status');
          figure.append(status);
          async function loadOriginal() {
            status.replaceChildren();
            try {
              let url = side.path;
              if (window.familyPhotoBlob) {
                const blob = await window.familyPhotoBlob(side, controller.signal);
                if (controller.signal.aborted) return;
                url = URL.createObjectURL(blob);
                urls.push(url);
              }
              const original = new Image();
              original.src = url;
              await original.decode();
              if (controller.signal.aborted) return;
              if (side.rotation) {
                // The original remains unchanged when a scanned print needs turning for display.
                const rotated = document.createElement('canvas');
                rotated.width = sideways ? original.naturalHeight : original.naturalWidth;
                rotated.height = sideways ? original.naturalWidth : original.naturalHeight;
                const context = rotated.getContext('2d');
                context.translate(rotated.width / 2, rotated.height / 2);
                context.rotate(side.rotation * Math.PI / 180);
                context.drawImage(original, -original.naturalWidth / 2, -original.naturalHeight / 2);
                rotated.setAttribute('role','img');
                rotated.setAttribute('aria-label',image.alt);
                image.replaceWith(rotated);
              } else image.src = url;
            } catch {
              if (controller.signal.aborted) return;
              status.append(document.createTextNode('Не вдалося відкрити оригінал. '),button('Спробувати ще',loadOriginal));
            }
          }
          if (observer) {
            pending.set(figure,loadOriginal);
            observer.observe(figure);
          } else loadOriginal();
          article.append(figure);
        }
        if (photo.description) article.append(elem('p',photo.description,'family-photo-description'));
        article.append(metadata(photo));
        if (photo.videoFrame) {
          const frame = photo.videoFrame;
          const index = data.sources.findIndex(source => source.id === frame.sourceId && source.originalVideo);
          if (index >= 0) {
            const seconds = Math.round(frame.timestampMs / 1000);
            const time = [Math.floor(seconds / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
            const watch = button('Відкрити відео · '+time, () => {
              openSource(index, frame.timestampMs / 1000);
            });
            article.append(watch);
          }
        }
        if (photo.sourceUrl) {
          const link = elem('a','Повідомлення з фотографією');
          link.href = photo.sourceUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          article.append(link);
        }
        galleryBody.append(article);
      }
      disposeGallery = () => {
        controller.abort();
        observer?.disconnect();
        galleryBody.replaceChildren();
        for (const url of urls) URL.revokeObjectURL(url);
        if (trigger?.isConnected) trigger.focus({preventScroll:true});
      };
      dialog.showModal();
      close.focus({preventScroll:true});
      galleryBody.scrollTop = first ? first.getBoundingClientRect().top - galleryBody.getBoundingClientRect().top + galleryBody.scrollTop : 0;
    }
    close.onclick = () => dialog.close();
    dialog.addEventListener('close',() => { disposeGallery?.(); disposeGallery = null; });

    function personStrip(person) {
      const entries = photosByPerson.get(person.id);
      if (!entries?.length) return null;
      const trigger = button('', () => openGallery(entries,person.name,null,trigger),'person-photo-trigger');
      trigger.setAttribute('aria-label','Відкрити фотографії · '+person.name);
      const previews = elem('span',undefined,'person-photo-previews');
      for (const photo of entries.slice(0,3)) previews.append(thumbnail(photo));
      trigger.append(previews,elem('span','Фотографії · '+entries.length));
      return trigger;
    }

    const section = document.getElementById('familyAlbum');
    const grid = document.getElementById('familyAlbumGrid');
    const input = document.getElementById('familyAlbumSearch');
    function showAlbum() {
      const words = normalise(input.value).trim().split(/\s+/);
      const filtered = photos.filter(photo => words.every(word => searchText.get(photo.id).includes(word)));
      grid.replaceChildren();
      for (const photo of filtered) {
        const tile = button('',()=>openGallery(filtered,'Родинні фотографії',photo.id,tile),'photo');
        tile.append(thumbnail(photo),elem('strong',photo.title));
        if (photo.takenLabel) tile.append(elem('span',photo.takenLabel));
        grid.append(tile);
      }
      document.getElementById('familyAlbumEmpty').hidden = !!filtered.length;
    }
    if (photos.length) {
      section.hidden = false;
      input.oninput = showAlbum;
      showAlbum();
    }
    let exportCache;
    function prepareLocalPng() {
      if (location.protocol !== 'file:' || !avatars.size) return;
      if (!exportCache) {
        // A local script can supply the small thumbnails when Chrome restricts reading file:// image pixels.
        exportCache = new Promise(resolve => {
          const loader = document.createElement('script');
          loader.src = 'case/photos/family/export-portraits.js';
          loader.onload = loader.onerror = () => { loader.remove(); resolve(); };
          document.head.append(loader);
        });
      }
      return exportCache;
    }
    return {
      prepareLocalPng, avatar, personStrip, count:photos.length, sourceIds:new Set(photos.map(photo => photo.sourceId).filter(Boolean)),
      keywords: person => (photosByPerson.get(person.id) || []).map(photo => searchText.get(photo.id)).join(' ')
    };
  }
};
