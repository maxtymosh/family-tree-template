/* Ukrainian name forms for chart captions. The person's stored label remains verbatim. */
window.AncestorNames = (() => {
  'use strict';

  const genitives = {
    'Основна особа':'основної особи', Алла:'Алли', Денис:'Дениса', Раїса:'Раїси', Віктор:'Віктора',
    Лариса:'Лариси', Олександр:'Олександра', Григорій:'Григорія', Євдокія:'Євдокії',
    Олексій:'Олексія', Ольга:'Ольги', Микола:'Миколи', Любов:'Любові', Яків:'Якова',
    Тетяна:'Тетяни', Йосип:'Йосипа', Ганна:'Ганни', Агафія:'Агафії', Данило:'Данила',
    'Агаф’я':'Агаф’ї', Андрій:'Андрія', Павло:'Павла', Ігнатій:'Ігнатія',
    Анна:'Анни', Сергій:'Сергія', Валентина:'Валентини', Анастасія:'Анастасії',
    Василь:'Василя', Никифор:'Никифора', Сава:'Сави', Марія:'Марії', Терентій:'Терентія',
    Ксенія:'Ксенії', Семен:'Семена'
  };
  const inUkrainian = {
    Василий:'Василь', Николай:'Микола', Любовь:'Любов', Яков:'Яків', Татьяна:'Тетяна',
    Агафья:'Агаф’я', Игнатий:'Ігнатій', Сергей:'Сергій', Анастасия:'Анастасія'
  };
  const knownQualifiers = {};

  function readName(person) {
    const stored = (person?.name || '').trim();
    const main = stored.split(/[(,]/,1)[0].trim();
    const parts = main.split(/\s+/);
    // Family records put the given name either before or after the surname.
    for (const token of parts.slice(0,2)) {
      const first = inUkrainian[token] || token;
      if (Object.hasOwn(genitives,first)) return {stored,parts,token,first};
    }
    return {stored,parts,token:null,first:null};
  }

  function forPerson(person, directPeople = []) {
    const {stored,parts,token,first} = readName(person);
    if (!first) return {name:stored || 'Ім’я не записане',genitive:null};
    const qualifier = knownQualifiers[parts.slice(0,2).join(' ')];
    let name = qualifier?.[0] || first;
    let genitive = qualifier?.[1] || genitives[first];
    if (!qualifier && parts.length > 1) {
      const surname = parts[0] === token ? parts[1] : parts[0];
      const peers = directPeople.filter(other => other.key !== person.key).map(readName)
        .filter(other => other.first === first);
      if (peers.length) {
        const sameInitial = peers.some(other => {
          const qualifierPart = other.parts[0] === other.token ? other.parts[1] : other.parts[0];
          return qualifierPart && qualifierPart[0] === surname[0];
        });
        // Use the complete recorded form if the shorter initial is ambiguous.
        if (sameInitial) return {name:stored,genitive:null};
        name += ' '+surname[0]+'.';
        genitive += ' '+surname[0]+'.';
      }
    }
    if (stored.includes('(?)') || /Прочитання імені та прізвища попереднє/iu.test(person.notes || '')) {
      return {name:name+' (?)',genitive:genitive+' (?)'};
    }
    return {name,genitive};
  }
  return {forPerson};
})();
