'use strict';

window.LifeDates = {
  format(person) {
    const birth = person.born || '';
    const death = person.died || '';
    const deceased = !!death || person.livingStatus === 'deceased';
    const birthLabel = birth ? 'нар. ' + birth : '';
    const details = [];
    if (birth) details.push('Народження — ' + birth);

    let text = birthLabel;
    let deathValue = death;
    if (deceased) {
      text = [birthLabel, 'пом. ' + (death || '?')].filter(Boolean).join(' — ');
      details.push(death ? 'Смерть — ' + death : 'Смерть зафіксовано. Дату не записано.');
      if (!death) deathValue = 'Дату не записано';
    }
    return {text, detail: details.join(' · '), birth, death: deathValue};
  }
};
