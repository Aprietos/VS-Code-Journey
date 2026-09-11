# Capa de dades de procés

Document de referència per a qui continuï el projecte sense haver vist com
es va fer. Descriu **què hi ha ara mateix** a la capa de dades de procés de
l'Editor P&ID, on viu cada cosa i quines regles no s'han de trencar.

Escrit en acabar l'**etapa 1** (assignar producte, quantitats i paràmetres
físics als elements i a les línies de transport, i guardar-ho amb el
projecte). Res del que hi ha aquí simula res: no hi ha motor de simulació,
ni temps, ni transferència de massa, ni seqüències. Vegeu
[Què NO hi ha](#què-no-hi-ha).

---

## 1. Els fitxers

El projecte no té build, ni empaquetador, ni dependències: són fitxers
estàtics que el navegador carrega tal qual. `index.html` els carrega en
aquest ordre, que **importa**.

| Fitxer | Què fa |
| --- | --- |
| `index.html` | Marcatge. Barra d'eines, `<svg id="canvas">`, panell de línies de transport i panell de configuració de procés. |
| `process.js` | **Capa de dades de procés.** No toca el DOM. Defineix l'esquema de les fitxes, el magatzem, la signatura de línia, la detecció aigües amunt, la validació i la serialització. |
| `script.js` | Tota la resta: dibuix dels elements, canonades, selecció, zoom/pan, rols, detecció de línies de transport, panells, desfer/refer i arxius. |
| `styles.css` | Estils. |
| `Exemples/` | Models `.pid.json` de mostra. |

`process.js` s'ha de carregar **abans** que `script.js`, perquè defineix la
constant global `ProcessModel` que `script.js` fa servir.

### Per què dos fitxers

La regla de separació de capes és: **`process.js` no sap què és un SVG i
`script.js` no conté lògica de procés.** Quan la lògica necessita conèixer
la topologia del diagrama, `script.js` l'hi passa com una estructura plana
(vegeu `buildProcessGraph()`), mai elements del DOM. Aquesta és l'única
passarel·la entre les dues capes; manteniu-la.

---

## 2. Rols dels elements

Un element té **com a màxim un rol**, i són mútuament excloents. El rol viu
a l'atribut `data-transport-role` de l'element SVG, amb un número correlatiu
a `data-transport-role-id` (el distintiu "P1", "C2", "S1" que es veu al
canvas).

| Constant (`script.js`) | Valor desat | Etiqueta a pantalla | Distintiu |
| --- | --- | --- | --- |
| `ROLE_PICKUP` | `pickup` | Pickup Point | `P` |
| `ROLE_CONSUMPTION` | `consumption` | Punt de consum | `C` |
| `ROLE_STORAGE` | `storage` | Element d'emmagatzematge | `S` |

Quins tipus d'element admeten quin rol es declara a `ROLE_TYPES`:

```js
const ROLE_TYPES = {
  [ROLE_PICKUP]:      ['injector'],
  [ROLE_CONSUMPTION]: ['hopper'],
  [ROLE_STORAGE]:     ['silo', 'bagdump', 'hopper'],
};
```

`hopper` (Tolva filtre) hi surt dues vegades: pot ser punt de consum **o**
element d'emmagatzematge, mai les dues coses. `requestRoleChange()` demana
confirmació (`window.confirm`) abans de substituir un rol per un altre.

Les tres cadenes `'pickup'`, `'consumption'` i `'storage'` són un **contracte
estable**: les fan servir `script.js`, `process.js`, l'atribut de l'element i
l'arxiu desat. No es canvien sense una migració.

---

## 3. El model de dades (`process.js`)

### 3.1 Esquema de les fitxes

`ProcessModel.schemaFor(kind)` retorna la llista de camps d'una fitxa. Hi ha
quatre menes de fitxa: els tres rols, més `'line'`.

| Fitxa | Camps |
| --- | --- |
| `storage` | `name` (text), `product` (text), `quantity` (kg), `capacity` (kg) |
| `consumption` | `name` (text), `product` (text), `quantity` (kg, per defecte 0), `capacity` (kg) |
| `pickup` | `name` (text) — el producte **no** és un camp, s'hereta de l'storage detectat |
| `line` | `name` (text), `throughput` (kg/h, **> 0**), `diameter` (mm), `length` (m) |

L'esquema és **l'única definició**: el formulari del panell, la validació i
els valors per defecte en surten tots d'aquí. Afegir un camp nou és afegir
una entrada a `SCHEMAS` i res més.

Camp addicional fora de l'esquema: `storageChoice` a la fitxa d'un `pickup`
(l'element d'emmagatzematge triat a mà, vegeu §5). No és un camp de dades
sinó una decisió que mana sobre un càlcul, i per això no surt a l'esquema
però sí que es desa.

### 3.2 Unitats i números

- Massa **kg**, rendiment **kg/h**, diàmetre **mm**, longitud **m**. La
  unitat es dibuixa sempre dins l'etiqueta del camp.
- `ProcessModel.parseNumber()` accepta la **coma decimal** (`1500,25`).
- Es desa **sense arrodonir**. L'arrodoniment és només de pantalla:
  `ProcessModel.formatKg()` dona kg amb 1 decimal en format català.
- `validate()` rebutja números negatius i, als camps marcats `positive: true`
  (ara només `throughput`), també el 0.

### 3.3 El magatzem

```js
{
  elements: { "silo-3": { name, product, quantity, capacity }, ... },
  lines:    { "<signatura>": { name, throughput, diameter, length }, ... },
}
```

Dos diccionaris plans. `elements` va indexat per l'identificador de
l'element (`silo-3`, `hopper-12`); `lines`, per la **signatura** de la línia
(§4), mai pel seu número visible.

**Regla important: aquí no s'esborra res sol.** Si desapareix un element o
una línia, la seva fitxa es queda com a **òrfena**. Això és deliberat: si
l'usuari desfà el canvi al diagrama, la configuració hi torna sola. Només
s'esborra per acció explícita (el botó "Elimina" de les configuracions sense
línia, o "Neteja tot", que buida el model sencer).

### 3.4 API pública

`ProcessModel` exposa: `ROLES`, `schemaFor`, `defaultsFor`, `getElement`,
`setElement`, `hasElement`, `deleteElement`, `getPickupChoice`,
`setPickupChoice`, `getLine`, `setLine`, `hasLine`, `deleteLine`,
`orphanLines`, `lineSignature`, `findUpstreamStorage`, `resolvePickupSource`,
`parseNumber`, `formatKg`, `validate`, `serialize`, `load`, `clear`.

`getElement(id, role)` i `getLine(signature)` **sempre retornen una fitxa
completa** (valors per defecte inclosos), tant si existeix com si no. Per
saber si l'usuari l'ha configurada mai, feu servir `hasElement` / `hasLine`.

---

## 4. Signatura d'una línia de transport (crític)

Les línies de transport són **derivades**: `findTransportLines()`
(a `script.js`) les torna a calcular des de la topologia cada cop que es
prem "Recalcular", i el seu número visible pot canviar. La configuració de
l'usuari, en canvi, no es pot perdre.

```js
lineSignature(line) === [
  line.pickupPointId,        // identificador de l'element de recollida
  line.consumptionPointId,   // identificador de l'element de consum
  line.pathElementIds.join('>'),
].join('|')
```

Exemple: `injector-5|hopper-6|injector-5>airlock-4>hopper-6`

**Què hi entra i què no, i per què:**

- ✅ Identificadors d'element, que són estables i no es reutilitzen.
- ❌ Coordenades: moure un element no ha de perdre la configuració.
- ❌ Ordre de detecció ni número de línia: canvien a cada recàlcul.
- ❌ **Connectors (canonades).** Deliberat: així, esborrar una connexió i
  tornar-la a fer recupera la configuració encara que la canonada nova no
  surti exactament pels mateixos punts de connexió.

**Limitació coneguda:** dues rutes diferents entre el mateix parell que
passin exactament pels mateixos elements (canonades paral·leles per ports
diferents) comparteixen signatura i, per tant, configuració. És un cas
degenerat i es va acceptar a canvi de la robustesa davant del re-cablejat.

Les configuracions que no corresponen a cap línia detectada surten a
l'apartat "Configuracions sense línia" del panell (`paintOrphanLines()`), amb
un botó per eliminar-les a mà. Una línia sense configuració es marca
explícitament com a "Sense configurar".

---

## 5. Detecció de l'element d'emmagatzematge aigües amunt

`ProcessModel.findUpstreamStorage(graph, startId, canCross)`

Recorregut **en amplada** (BFS) des del punt de recollida, seguint només les
connexions reals. **Mai** es fa servir la proximitat gràfica ni les
coordenades.

Regles:

1. Els elements **amb rol** (`pickup`, `consumption`, `storage`) són finals
   de recorregut: no s'hi passa a través. **Sense excepcions**, i en
   particular tampoc per als injectors: el magatzem que alimenta un segon
   injector no és el que alimenta el primer. (Això és diferent de la
   detecció de línies de transport, vegeu la nota al final d'aquesta
   secció.)
2. Els elements **sense rol** (vàlvules, escluses, tolves pantaló, ciclons…)
   es travessen lliurement.
3. El primer element amb rol `storage` que es troba és la font. Es retorna
   també el **recorregut** (`path`), del punt de recollida fins a l'storage.
4. Si a la mateixa distància mínima n'hi ha més d'un, **no se'n tria cap**:
   `status: 'ambiguous'` amb la llista de `candidates`, i decideix l'usuari.
5. Si no se'n troba cap: `status: 'none'`. Mai es falla en silenci; el
   panell ho diu ("Sense origen detectat").

El recorregut va per **estats `(element, port d'entrada)`** i no només per
element, perquè en un element amb restriccions de forma el camí que es pot
continuar depèn de per on s'hi ha entrat. `canCross` és el ganxo que imposa
aquestes restriccions; `script.js` hi passa `canCrossElement`, que fa complir
que una desviadora no deixi passar el producte d'una branca a l'altra sense
passar pel punt comú (vegeu `PORT_SIDES` a `script.js`).

**Quan s'executa:** en obrir la fitxa d'un punt de recollida i en prémer
"Tornar a detectar". Mai de forma contínua.

### Elecció manual

`ProcessModel.resolvePickupSource(graph, pickupId, canCross, choiceOverride)`
és la funció que s'ha de fer servir des de fora: fa la detecció i després hi
aplica l'elecció manual de l'usuari, que **mana sempre** mentre l'element
triat continuï existint i tenint rol `storage`.

Estats que retorna: `'found'` (detecció automàtica), `'ambiguous'`,
`'none'`, `'chosen'` (mana l'elecció manual; amb `stale: true` si aquell
element ja no surt entre els candidats detectats).

`choiceOverride` serveix perquè el panell pugui ensenyar el resultat d'una
elecció que l'usuari acaba de fer i encara no ha desat.

### Nota: injectors en sèrie

Hi ha una asimetria **deliberada** entre els dos recorreguts del programa:

| | Element amb rol trobat pel camí |
| --- | --- |
| `findUpstreamStorage` (aquí) | **Sempre** final de recorregut |
| `findTransportLines` (`script.js`) | Final de recorregut, **excepte els injectors** |

Un injector injecta el seu producte al corrent d'aire però no l'atura: per a
una línia de transport que hi passa pel mig és un tram de canonada. Per això
dos injectors en sèrie, tots dos punts de recollida, donen **dues** línies
cap al mateix punt de consum: la del segon, i la del primer travessant el
segon. Ho controla `TRAVERSABLE_WITH_ROLE_TYPES` a `script.js`.

Per a la cerca del magatzem, en canvi, aturar-se és l'únic correcte: si es
travessés el segon injector, se li atribuiria al primer un magatzem que no
és el seu.

**L'storage detectat i el producte heretat NO es desen.** Són informació
derivada i es tornen a calcular. El que es desa és la decisió
(`storageChoice`). Una etapa posterior que necessiti saber d'on ve el
producte ha de cridar `resolvePickupSource()`, no llegir cap camp desat.

---

## 6. Format de guardat

Un arxiu `.pid.json` és:

```json
{
  "format": "pid-editor-model",
  "version": 2,
  "savedAt": "2026-09-11T...",
  "view":  { "x": 0, "y": 0, "scale": 1 },
  "state": {
    "elements": [ { "x": 0, "y": 0, "data": { "id": "silo-1", "type": "silo", ... } } ],
    "pipes":    [ { "fromId": "...", "fromRole": "...", ... } ],
    "elementCount": 12,
    "process": { "elements": { ... }, "lines": { ... } }
  }
}
```

`state` és **exactament** la mateixa captura que fa servir desfer/refer
(`serializeState()`). Això és el que garanteix que el que es desa i el que es
torna a obrir siguin idèntics, i que el model de procés entri a l'historial
sense codi a part: **configurar una fitxa es pot desfer** com moure o
connectar.

### Versions i migracions

`FILE_VERSION` és **2** i **no s'ha apujat en aquesta etapa**. La regla del
format (documentada a `script.js`) és que només es puja quan un canvi
**trenca** la compatibilitat; afegir un camp opcional no ho fa. Un arxiu
antic sense `state.process` obre perfectament i el model queda buit, que és
el que toca.

Migracions existents a `MODEL_MIGRATIONS`:

- **v1 → v2**: els punts de connexió de la desviadora es deien
  `input`/`output`/`output2` i ara es diuen `common`/`branch`/`branch2`.

Quan una etapa futura necessiti un canvi que trenqui alguna cosa: pugeu
`FILE_VERSION` i afegiu `MODEL_MIGRATIONS[n]`. `migrateModel()` les encadena
totes.

---

## 7. La interfície (`script.js`)

### Panell de configuració de procés

Un **únic** panell (`#process-panel`) per a les quatre fitxes. El formulari
es construeix des de l'esquema a `buildProcessFields()`, de manera que
afegir un camp no demana tocar l'HTML.

Com s'obre:

| Acció | Resultat |
| --- | --- |
| Doble clic sobre un element **amb** rol | Fitxa d'aquell rol |
| Doble clic sobre un element **sense** rol que en podria tenir | Menú de rols (comportament de sempre) |
| Doble clic sobre un element que no admet cap rol | Res (comportament de sempre) |
| Doble clic sobre una entrada del panell de línies | Fitxa de la línia |

`openProcessPanel(editor)` rep `{ kind, title, subject, values, onSave, renderExtra?, elementId? }`.
`onSave(values, raw)` rep els valors ja validats i convertits, i els crus.

Es va triar el panell lateral (i no el traçat al canvas) per obrir la fitxa
d'una línia perquè diverses línies comparteixen canonades i un clic sobre un
tram seria ambigu.

### Panell de línies de transport

`renderTransportLines()` recalcula i pinta; `paintLinesPanel()` només pinta,
a partir de `lastLinesResult`. Aquesta separació és el que permet que desar
la configuració d'una línia n'actualitzi el text **sense** refer la detecció
(que és sempre explícita: botó "Recalcular" o obrir el panell).

---

## 8. Regles que no s'han de trencar

1. **`process.js` no toca el DOM.** Si cal la topologia, es passa plana des
   de `script.js` amb `buildProcessGraph()`.
2. **La configuració no es perd mai sola.** Res del magatzem s'esborra per
   un canvi al diagrama; les fitxes queden òrfenes i tornen si es desfà.
3. **La signatura d'una línia no pot dependre de coordenades, de l'ordre de
   detecció ni del número de línia.**
4. **El que és derivat no es desa** (storage detectat, producte heretat, les
   línies mateixes). Es desa la decisió, no el resultat del càlcul.
5. **La detecció aigües amunt segueix les connexions, mai la geometria.**
6. **Els arxius antics s'han de continuar obrint.** Tot camp nou és opcional
   i amb valor per defecte raonable.
7. **Un element, un rol.** Substituir-lo demana confirmació.
8. **La detecció no és contínua**: només en obrir la fitxa o en prémer el
   botó corresponent.

---

## 9. Paranys coneguts

- **`clearAll()` reinicia `elementCount` a 0**, de manera que un element nou
  podria rebre l'identificador d'un d'esborrat. Per això `clearAll()` també
  crida `ProcessModel.clear()`. Si algun dia es canvia una de les dues
  coses, cal repassar l'altra.
- **El camp de línia es diu `length`.** `form.elements.length` retorna el
  nombre de controls del formulari, no aquest camp. El codi actual mai fa
  accés per nom (itera la col·lecció i llegeix `control.name`); si algú ho
  canvia, aquest camp és el que peta.
- **El selector d'origen viu fora del `<form>`** però hi està associat amb
  l'atribut `form="process-form"`, de manera que `readProcessForm()` el
  llegeix igual i es desa i es cancel·la amb la resta de la fitxa.
- **No hi ha validació creuada** entre `quantity` i `capacity` (es pot posar
  una quantitat més gran que la capacitat). No es va demanar.
- **El projecte no té tests automàtics ni build.** La comprovació d'aquesta
  etapa es va fer amb una pàgina temporal que carregava `process.js` i
  `script.js` en un navegador sense finestra i executava 70 assercions.
  No s'ha deixat al repositori.

---

## Què NO hi ha

Res d'això existeix, ni tan sols començat, i no s'ha de donar per fet:

- Motor de simulació, transferència de massa, evolució temporal.
- Seqüències, accions, durades, editor de seqüències.
- Play / Pausa / Stop, velocitats, cronograma, cursor temporal.
- Barres de nivell o percentatges sobre els elements del diagrama.
- Animacions de flux, partícules, ressaltat de línia activa.
- Tooltips de simulació, resums, informes.
- Validacions relatives a la simulació.

Idees anotades durant l'etapa 1 i **no** implementades a propòsit: avisar
quan la quantitat inicial supera la capacitat; avisar quan el producte d'un
punt de consum no coincideix amb el de l'storage que l'alimenta; poder posar
nom als elements sense rol.
