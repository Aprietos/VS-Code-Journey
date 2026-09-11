// ---- Executor de proves ----
// El projecte no té build ni gestor de paquets: són fitxers estàtics que el
// navegador obre tal qual. La infraestructura de proves més senzilla i més
// estàndard per a un projecte així és, doncs, una pàgina que s'obre i
// ensenya el resultat. No cal instal·lar res.
//
// Ús: Test.group('Nom'), Test.case('què comprova', () => { ... }), i les
// comprovacions llancen error quan fallen. Test.run() ho pinta tot.
const Test = (() => {
  'use strict';

  const cases = [];
  let currentGroup = 'General';

  function group(name) {
    currentGroup = name;
  }

  function testCase(name, fn) {
    cases.push({ group: currentGroup, name, fn });
  }

  // Els números es mostren sencers (sense arrodonir) perquè una diferència
  // a la quinzena xifra decimal es vegi, que és justament el que aquestes
  // proves han de detectar.
  function show(value) {
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return `"${value}"`;
    return JSON.stringify(value);
  }

  function fail(message) {
    throw new Error(message);
  }

  const assert = {
    // Igualtat EXACTA. És la que es fa servir per defecte: aquest motor ha
    // de donar números exactes, no aproximats.
    equal(actual, expected, what) {
      if (actual !== expected) {
        fail(`${what || 'valor'}: ha donat ${show(actual)} i s'esperava ${show(expected)}`);
      }
    },

    notEqual(actual, expected, what) {
      if (actual === expected) {
        fail(`${what || 'valor'}: no hauria de ser ${show(expected)}`);
      }
    },

    // Només per als casos on la coma flotant no pot donar un resultat
    // exacte (cabals que no divideixen bé). La tolerància ha de ser
    // ridículament petita: si cal afluixar-la, hi ha un problema de debò.
    close(actual, expected, tolerance, what) {
      if (!(Math.abs(actual - expected) <= tolerance)) {
        fail(`${what || 'valor'}: ha donat ${show(actual)} i s'esperava ${show(expected)} (± ${tolerance})`);
      }
    },

    // Comparació estructural estricta: qualsevol diferència, per petita que
    // sigui, fa fallar la prova.
    deepEqual(actual, expected, what) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) {
        fail(`${what || 'estructura'}: els dos resultats no són idèntics\n      A: ${a}\n      B: ${b}`);
      }
    },

    isTrue(value, what) {
      if (value !== true) fail(`${what || 'condició'}: s'esperava cert i ha donat ${show(value)}`);
    },

    isFalse(value, what) {
      if (value !== false) fail(`${what || 'condició'}: s'esperava fals i ha donat ${show(value)}`);
    },

    // `list` és una llista d'errors o d'avisos del motor.
    hasCode(list, code, what) {
      if (!list.some((item) => item.code === code)) {
        fail(`${what || 'llista'}: hi falta «${code}». Hi ha: ${list.map((i) => i.code).join(', ') || '(res)'}`);
      }
    },

    lacksCode(list, code, what) {
      if (list.some((item) => item.code === code)) {
        fail(`${what || 'llista'}: no hi hauria d'haver «${code}»`);
      }
    },

    // Els missatges els llegeix una persona: han de ser frases, no codis.
    readableMessages(list, what) {
      list.forEach((item) => {
        if (typeof item.message !== 'string' || item.message.length < 20) {
          fail(`${what || 'missatge'}: «${item.code}» no té un missatge entenedor`);
        }
      });
    },
  };

  function run() {
    const root = document.getElementById('results');
    const summary = document.getElementById('summary');
    let passed = 0;
    let failed = 0;
    let lastGroup = '';

    cases.forEach((item) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const heading = document.createElement('h2');
        heading.textContent = item.group;
        root.appendChild(heading);
      }

      const row = document.createElement('div');
      row.className = 'case';

      try {
        item.fn();
        passed += 1;
        row.classList.add('case--ok');
        row.textContent = `PASSA  ${item.name}`;
      } catch (error) {
        failed += 1;
        row.classList.add('case--fail');
        row.textContent = `FALLA  ${item.name}\n       ${error && error.message ? error.message : error}`;
      }

      root.appendChild(row);
    });

    summary.textContent = failed === 0
      ? `RESUM: ${passed} proves, totes correctes.`
      : `RESUM: ${passed} correctes, ${failed} FALLADES.`;
    summary.className = failed === 0 ? 'summary summary--ok' : 'summary summary--fail';
  }

  return { group, case: testCase, assert, run };
})();
