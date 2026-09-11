# Capa de dades de procés

Document de referència per a qui continuï el projecte sense haver vist com
es va fer. Descriu **què hi ha ara mateix** a la capa de dades de procés de
l'Editor P&ID, on viu cada cosa i quines regles no s'han de trencar.

Escrit en acabar l'**etapa 2**:

- **Etapa 1** — capa de dades de procés: rols d'element, producte,
  quantitats, capacitats, configuració de les línies de transport i
  detecció de l'element d'emmagatzematge aigües amunt (§1–§9).
- **Etapa 2** — **motor de càlcul de la simulació**: seqüència d'accions,
  compilació en trams, consulta d'estat en qualsevol instant i validació
  prèvia (§6, §7).

L'etapa 2 **no ha canviat res de la pantalla**: no hi ha cap botó ni cap
panell nou. El motor existeix, es pot executar i està provat, però encara no
el crida ningú des de la interfície. Vegeu [Què NO hi ha](#què-no-hi-ha).

---

## 1. Els fitxers

El projecte no té build, ni empaquetador, ni dependències: són fitxers
estàtics que el navegador carrega tal qual. `index.html` els carrega en
aquest ordre, que **importa**.

| Fitxer | Què fa |
| --- | --- |
| `index.html` | Marcatge. Barra d'eines, `<svg id="canvas">`, panell de línies de transport i panell de configuració de procés. |
| `process.js` | **Capa de dades de procés.** No toca el DOM. Defineix l'esquema de les fitxes, el model de seqüència, el magatzem, la signatura de línia, la detecció aigües amunt, la validació i la serialització. |
| `simulation.js` | **Motor de càlcul de la simulació.** No toca el DOM ni modifica res. Rep un escenari i retorna resultats (§6). |
| `script.js` | Tota la resta: dibuix dels elements, canonades, selecció, zoom/pan, rols, detecció de línies de transport, panells, desfer/refer i arxius. |
| `styles.css` | Estils. |
| `tests/` | Proves automàtiques del motor (§7). |
| `Exemples/` | Models `.pid.json` de mostra. |

L'ordre de càrrega és `process.js` → `simulation.js` → `script.js`:
`ProcessModel` i `SimulationEngine` són constants globals i s'han de definir
abans que qui les faci servir.

### Per què dos fitxers

La regla de separació de capes és: **`process.js` i `simulation.js` no
saben què és un SVG, i `script.js` no conté lògica de procés ni de càlcul.**
Quan la lògica necessita conèixer la topologia del diagrama, `script.js`
l'hi passa com una estructura plana (vegeu `buildProcessGraph()`), mai
elements del DOM. Aquesta és l'única passarel·la entre les capes;
manteniu-la. És també el que permet provar els números sense obrir cap
pantalla.

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
  [ROLE_STORAGE]:     ['silo', 'bagdump', 'hopper', 'gravityhopper', 'trouserhopper'],
};
```

`hopper` (Tolva filtre) hi surt dues vegades: pot ser punt de consum **o**
element d'emmagatzematge, mai les dues coses. `requestRoleChange()` demana
confirmació (`window.confirm`) abans de substituir un rol per un altre.

Marcar com a magatzem una tolva que fins ara feia de pas (la de gravetat o
la pantaló) la converteix en **terminal** de tots dos recorreguts, com
qualsevol element amb rol: les rutes que hi passaven pel mig s'aturen allà.
És el comportament correcte —un magatzem és un extrem—, però és un canvi
visible al panell de línies.

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

El camp `name` de la fitxa d'un element surt **ja omplert** la primera
vegada que s'obre, amb el format `Tipus - Distintiu` (`Silo - S1`,
`Injector - P7`, `Tolva filtre - C3`), que dona `defaultElementName()` a
`script.js`. No s'aplica a les línies: el seu número canvia a cada recàlcul
i un nom que el portés a dins quedaria desfasat.

### 3.2 La seqüència d'accions

Una seqüència és una llista **ordenada** d'accions que s'executen una
darrere l'altra, **sense solapaments**: només n'hi ha una d'activa alhora.
Viu a `ProcessModel` (`getSequence()` / `setSequence()`); qui l'executa és
el motor (§6).

```js
{ order: 1, type: 'transport', lineId: '<signatura de línia>', duration: 600 }
```

| Camp | Què és |
| --- | --- |
| `order` | Posició dins la seqüència: 1, 2, 3… `normalizeSequence()` la renumera sola a partir de la posició real a la llista. |
| `type` | Un de `ProcessModel.ACTION_TYPES`: `transport`, `rest` (Descans), `sweep` (Barrido), `startup` (Posada a règim). |
| `lineId` | La línia de transport (la seva **signatura**, §4). Obligatòria a les accions de transport. |
| `duration` | **En segons**, sempre més gran que 0. A la pantalla es veurà en minuts; el model no arrodoneix mai. |

**La seqüència encara NO es desa a l'arxiu del projecte.** `serialize()` la
deixa fora expressament i `load()` i `clear()` la buiden. Desar-la és feina
de l'etapa següent: s'hi afegeix a `serialize()` i a `load()` de
`process.js`, i prou.

### 3.3 Unitats i números

- Massa **kg**, rendiment **kg/h**, diàmetre **mm**, longitud **m**. La
  unitat es dibuixa sempre dins l'etiqueta del camp.
- `ProcessModel.parseNumber()` accepta la **coma decimal** (`1500,25`).
- Es desa **sense arrodonir**. L'arrodoniment és només de pantalla:
  `ProcessModel.formatKg()` dona kg amb 1 decimal en format català.
- `validate()` rebutja números negatius i, als camps marcats `positive: true`
  (ara només `throughput`), també el 0.

### 3.4 El magatzem

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

### 3.5 API pública

`ProcessModel` exposa: `ROLES`, `ACTION_TYPES`, `ACTION_LABELS`,
`getSequence`, `setSequence`, `createAction`, `normalizeSequence`,
`schemaFor`, `defaultsFor`, `getElement`,
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

## 6. El motor de simulació (`simulation.js`)

Donada una situació inicial i una seqüència d'accions, el motor sap
exactament quants kg hi ha a cada lloc en cada instant. **No toca el DOM,
no modifica mai les dades del projecte i es pot executar sense obrir cap
pantalla.** Tres funcions:

```js
const compiled = SimulationEngine.compile(scenario);   // ho precalcula tot
const state    = SimulationEngine.stateAt(compiled, 180);  // estat al segon 180
const report   = SimulationEngine.validate(scenario);  // errors i avisos
```

### 6.1 L'escenari que rep

Un objecte pla. El motor no en modifica mai res.

```js
{
  storages: {
    'silo-3': { name: 'Silo farina', product: 'Farina', quantity: 1000, capacity: 20000 },
  },
  consumptions: {
    'hopper-8': { name: 'Amassadora', product: 'Farina', quantity: 0, capacity: 800 },
  },
  lines: {
    '<signatura>': {
      name: 'L1', throughput: 600,      // kg/h
      configured: true,                  // opcional; false = encara no configurada
      pickupId: 'injector-5', pickupName: 'Injector - P1',
      consumptionId: 'hopper-8',
      storageId: 'silo-3',
      storageStatus: 'found',            // 'found' | 'chosen' | 'ambiguous' | 'none'
    },
  },
  actions: [ /* vegeu §3.2 */ ],
}
```

**Qui construeix aquest escenari a partir del diagrama de debò encara no
existeix**: és feina de l'etapa següent. Tota la informació hi és, però:

| Camp de l'escenari | D'on surt |
| --- | --- |
| `storages` / `consumptions` | `ProcessModel.getElement(id, rol)` per a cada element amb rol `storage` / `consumption` (`elementsWithRole()` a `script.js` els llista). |
| clau de `lines` | `ProcessModel.lineSignature(line)` de cada línia de `findTransportLines()`. |
| `name`, `throughput` | `ProcessModel.getLine(signatura)`; `configured` ← `ProcessModel.hasLine(signatura)`. |
| `pickupId` / `consumptionId` | `line.pickupPointId` / `line.consumptionPointId` de `findTransportLines()`. |
| `storageId` / `storageStatus` | `ProcessModel.resolvePickupSource(buildProcessGraph(), pickupId, canCrossElement)` → `.storageId` i `.status`. |

### 6.2 Com es calcula: moments clau i trams

El motor **no** simula sumant increments petits instant a instant. Això
acumularia error, faria que el resultat depengués de la mida del pas i
impediria moure el cursor enrere amb precisió. En comptes d'això:

1. `compile()` calcula per endavant **tots els moments clau**: l'inici i el
   final de cada acció i, quan un element d'emmagatzematge s'esgota enmig
   d'una acció, **l'instant exacte** en què passa. Aquest instant surt de
   **dividir la massa que queda pel cabal**, no de provar instants:
   `segons = kg · 3600 / (kg/h)`.
2. Entre dos moments clau consecutius **tot varia de manera perfectament
   lineal**. Cada tram guarda la situació **exacta al seu inici** i el
   cabal de cada element durant el tram.
3. `stateAt()` és llavors: trobar el tram i interpolar.

D'aquí surten dues garanties que **no es poden trencar**:

- `stateAt(compiled, t)` és una **funció pura** de `(compiled, t)`. No
  guarda estat, no depèn de cap consulta anterior. Consultar el minut 3
  dona sempre exactament el mateix resultat, s'hi arribi com s'hi arribi i a
  la velocitat de reproducció que sigui.
- Els valors al final de cada tram es calculen **una sola vegada** i es fan
  servir com a inici exacte del següent. Mai s'arrosseguen interpolacions.

Dos detalls que fan que els números surtin rodons:

- Els càlculs es fan **multiplicant primer i dividint per 3600 al final**
  (`kg/h × segons / 3600`), no convertint el cabal a kg/s abans. Així 600
  kg/h durant 600 s dona **100 kg exactes**, no 99,999999999999.
- Just a la frontera entre dos trams, `stateAt()` agafa el valor guardat
  com a **inici del tram nou**, no el que sortiria d'interpolar el tram
  anterior. I al final de tot fa servir `compiled.final`, calculat i no
  interpolat.

### 6.3 Què retorna `compile()`

```js
{
  ok: true,
  errors: [], warnings: [ { code, message, atSeconds, ... } ],
  segments: [ {
    index, startTime, endTime, actionOrder, actionType, lineId, moving,
    storages:     { id: { start, ratePerHour, rate } },   // rate negatiu
    consumptions: { id: { start, ratePerHour, rate } },
    lines:        { id: { start, ratePerHour, rate } },   // kg acumulats per línia
  } ],
  actions: [ {
    order, type, lineId, startTime, endTime, duration, moving,
    transferred,          // kg realment moguts
    complete,             // false si s'ha quedat curta
    incompleteReason,     // 'storage-empty'
  } ],
  keyTimes: [ 0, 300, 600, ... ],   // tots els moments clau, en segons
  totalDuration: 720,
  final: { storages: {...}, consumptions: {...}, lines: {...} },
}
```

`ratePerHour` (kg/h) és el número **autoritatiu**; `rate` (kg/s) és el
mateix valor per ensenyar-lo per pantalla. Per interpolar, feu servir
`stateAt()`.

### 6.4 Què retorna `stateAt()`

```js
{
  time, totalDuration, finished,
  action: { order, type, lineId, startTime, endTime, duration, progress, complete, incompleteReason },
  activeLineId,                  // '' si en aquell instant no es mou res
  storages:     { id: kg },
  consumptions: { id: kg },      // kg acumulats (quantitat inicial inclosa)
  lines:        { id: kg },      // kg transferits per aquella línia
  warnings: [ ... ],             // només els que ja han passat (atSeconds <= time)
}
```

El temps demanat es retalla a `[0, totalDuration]`: consultar abans del
començament o després del final no dispara mai.

### 6.5 Límits físics

- **Una línia no pot transferir mai més del que queda** al seu element
  d'emmagatzematge. En arribar a 0 kg la transferència s'atura **en
  l'instant exacte** i l'acció queda `complete: false` amb
  `incompleteReason: 'storage-empty'` i els kg realment transferits.
- **Passar de la capacitat d'un punt de consum es permet**, però genera
  l'avís `capacity-exceeded` amb l'instant exacte en què passa. Una
  capacitat de 0 vol dir "encara no definida" i no es comprova.

**On afegir-ne més:** a `buildAction()` de `simulation.js`. Cada límit nou
(pressió mínima, cabal màxim de la canonada, temps de posada a règim…) és un
moment clau més i, per tant, un tall de tram més. El patró a seguir és el de
l'element que es buida: calcular l'instant exacte, tallar-hi el tram i
marcar l'acció.

**Física de barrido i posada a règim:** avui només ocupen temps. El lloc per
començar a canviar-ho és la taula `MOVES_PRODUCT` de `simulation.js`, i
després `buildAction()`, que és qui decideix quins trams genera cada acció.

### 6.6 Errors i avisos

Els **errors bloquegen** (`ok: false`, no es calcula res). Els **avisos no
bloquegen**. Tots porten `code` (per al programa) i `message` (una frase
pensada per a un enginyer que no programa). Quan hi ha errors, la llista
d'avisos ve buida: no s'informa a mitges d'un càlcul que no s'ha fet.

| Codi d'error | Quan salta |
| --- | --- |
| `empty-sequence` | La seqüència no té cap acció. |
| `invalid-duration` | Una acció té durada zero o negativa. |
| `unknown-action-type` | El tipus d'acció no és cap dels coneguts. |
| `missing-line` | Una acció de transport no té línia, o la que tenia ja no existeix. |
| `line-not-configured` | La línia encara no s'ha configurat (`configured: false`). |
| `line-no-throughput` | La línia no té rendiment o és 0. |
| `line-without-source` | La línia no té Pickup Point d'origen. |
| `line-without-target` | La línia no té punt de consum de destí. |
| `storage-not-detected` | El Pickup Point no té cap element d'emmagatzematge que l'alimenti. |
| `storage-ambiguous` | La detecció va donar més d'un candidat i no se n'ha triat cap. |
| `storage-empty` | L'element d'emmagatzematge comença sense gens de producte. |
| `product-mismatch` | El producte de l'origen i el del destí d'una línia no coincideixen. |

| Codi d'avís | Quan salta |
| --- | --- |
| `storage-will-empty` | Un element d'emmagatzematge es buidarà durant la seqüència. Porta `atSeconds`. |
| `capacity-exceeded` | Un punt de consum passa de la seva capacitat màxima. Porta `atSeconds`. |

**Producte en blanc = "encara no definit"**, i no contradiu res: només hi ha
`product-mismatch` si les dues bandes en tenen un i són diferents. Això vol
dir que si un punt de consum sense producte rep de dos magatzems amb
productes diferents, ara mateix no salta cap error (vegeu §11).

## 7. Les proves automàtiques

**Com executar-les: obre `tests/tests.html` amb el navegador** (doble clic al
fitxer). Si tot va bé, la barra de dalt surt **verda** i diu
`RESUM: 33 proves, totes correctes.`. Per tornar-les a executar, F5.

No cal instal·lar res: el projecte no té build ni gestor de paquets, i la
pàgina carrega `process.js` i `simulation.js` **de debò**, no una còpia.

| Fitxer | Què és |
| --- | --- |
| `tests/tests.html` | La pàgina que s'obre. |
| `tests/runner.js` | Executor mínim: `Test.group()`, `Test.case()` i les comprovacions. |
| `tests/simulation.test.js` | Les proves del motor. |

Les comprovacions són d'**igualtat exacta** per defecte (`assert.equal`).
`assert.close` només es fa servir quan la coma flotant no pot donar un
resultat exacte, i amb un marge ridículament petit. Si algun dia cal
afluixar-lo, hi ha un problema de debò.

## 8. Format de guardat

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

## 9. La interfície (`script.js`)

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

## 10. Regles que no s'han de trencar

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
9. **El motor no toca mai les dades del projecte.** Rep un escenari i
   retorna resultats nous.
10. **El càlcul no és acumulatiu.** Res de sumar increments a cada instant:
    moments clau precalculats i interpolació lineal dins de cada tram.
11. **`stateAt()` ha de continuar sent una funció pura.** El dia que guardi
    estat entre crides, el mateix instant deixarà de donar el mateix
    resultat i tot el disseny se'n va en orris.
12. **Els errors es detecten abans de començar**, mai enmig del càlcul.

---

## 11. Paranys coneguts

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
- **El projecte no té build ni gestor de paquets.** Les proves del motor
  són una pàgina que s'obre (§7). La interfície (`script.js`) no té proves
  automàtiques: es comprova a mà.
- **La massa es conserva fins on arriben els números en coma flotant.** Amb
  un cabal que no divideix bé (777 kg/h, per exemple) el que baixa d'un
  magatzem i el que puja a un consum poden diferir en unes 10⁻¹⁴ kg, perquè
  90,65 no es pot escriure exactament en binari. No és cap error de
  l'algorisme i no hi ha manera de fer-ho millor amb números decimals
  normals. Hi ha una prova que ho vigila amb un marge de 10⁻⁹ kg.
- **Si un punt de consum no té producte definit**, pot rebre de dos
  magatzems amb productes diferents sense que salti cap error. La
  comprovació de productes és per línia (origen contra destí) i un producte
  en blanc no contradiu res.

---

## Què NO hi ha

Res d'això existeix, ni tan sols començat, i no s'ha de donar per fet:

- **Cap element d'interfície de simulació**: ni botons, ni panells, ni
  modals, ni botó de càlcul de temps.
- Editor visual de seqüències (l'estructura de dades sí, §3.2; l'editor no).
- Play / Pausa / Stop, velocitats, cronograma, cursor temporal.
- Barres de nivell o percentatges sobre els elements del diagrama.
- Animacions de flux, partícules, ressaltat de línia activa.
- Tooltips de simulació, resums, informes.
- Desar la seqüència a l'arxiu del projecte (§3.2).
- El pont que construeix l'escenari a partir del diagrama (§6.1).
- Física de barrido i posada a règim (§6.5).
- Accions en paral·lel. L'execució és estrictament seqüencial. Els trams
  porten inici i final **absoluts**, de manera que el dia que calgui
  permetre solapaments el que canviarà és com es decideixen aquests
  inicis, no la resta del motor.

Idees anotades i **no** implementades a propòsit: poder posar nom als
elements sense rol; avisar quan un punt de consum sense producte rep de dos
magatzems amb productes diferents (§11); avisar quan una acció queda
incompleta (avui es veu a `compiled.actions[].complete`, però no genera cap
avís propi).
