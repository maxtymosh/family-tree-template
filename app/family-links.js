'use strict';
window.FamilyLinks = (() => {
  const idPattern = /^P-\d{4,}$/;
  function read(hash) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const route = {};
    for (const key of ['family', 'person']) {
      if (idPattern.test(params.get(key))) route[key] = params.get(key);
    }
    if (['memory', 'archive'].includes(params.get('sources'))) route.sources = params.get('sources');
    return route;
  }
  async function copy(route) {
    if (location.protocol === 'file:') throw new Error('Для спільних посилань опублікуйте дерево на власному сайті.');
    const url = new URL(location.href);
    const params = new URLSearchParams();
    for (const key of ['family', 'person']) {
      if (idPattern.test(route[key])) params.set(key, route[key]);
    }
    if (!params.size) throw new Error('Оберіть людину або гілку.');
    if (['memory', 'archive'].includes(route.sources)) params.set('sources', route.sources);
    url.hash = params.toString();
    try { await navigator.clipboard.writeText(url.href); }
    catch {
      const error = new Error('Скопіюйте виділене посилання вручну.');
      error.url = url.href;
      throw error;
    }
  }
  return {read, copy};
})();
