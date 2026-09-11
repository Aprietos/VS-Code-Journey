# Capa de dades de procés

Document de referència per a qui continuï el projecte sense haver vist com
es va fer. Descriu **què hi ha ara mateix** a la capa de dades de procés de
l'Editor P&ID, on viu cada cosa i quines regles no s'han de trencar.

Escrit en acabar l'**etapa 4**, l'última del pla:

- **Etapa 1** — capa de dades de procés: rols d'element, producte,
  quantitats, capacitats, configuració de les línies de transport i
  detecció de l'element d'emmagatzematge aigües amunt.
- **Etapa 2** — **motor de càlcul**: seqüència d'accions, compilació en
  trams, consulta d'estat en qualsevol instant i validació prèvia (§6, §7).
- **Etapa 3** — **interfície de simulació**: editor de seqüència, controls
  de reproducció, cronograma amb cursor arrossegable i estat numèric (§8).
- **Etapa 4** — **capa visual sobre el diagrama**: barres de nivell, línia
  activa destacada, flux de producte, informació en passar el ratolí i
  resum (§9).

Vegeu [Què NO hi ha](#què-no-hi-ha).

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
| `script.js` | Tota la resta: dibuix dels elements, canonades, selecció, zoom/pan, rols, detecció de línies de transport, panells, **interfície de simulació** (§8), desfer/refer i arxius. |
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
| `lineId` | La línia de transport (la seva **signatura**, §4). **Obligatòria** a les accions de transport i **opcional** al barrido, on només diu per quina canonada es fa la neteja. Als altres tipus s'ignora. |
| `duration` | **En segons**, sempre més gran que 0. A la pantalla es veurà en minuts; el model no arrodoneix mai. |

La seqüència **es desa amb el model**, a `state.process.sequence`.
`load()` la passa per `normalizeSequence()`, de manera que un arxiu tocat a
mà no la pot deixar en un estat estrany. `clear()` (i, per tant, «Neteja
tot») la buida.

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

## 4b. Bombes bufadores

La bomba és el que fa moure el producte per una línia. **El seu tipus no el
tria l'usuari**: es dedueix de com està connectada al diagrama
(`detectPumps()` a `script.js`).

| Com està connectada | Tipus | Quines línies pot fer funcionar |
| --- | --- | --- |
| Al port `input` d'un **injector amb rol de punt de recollida** (el connector de darrere, per on li entra l'aire) | **impulsió** | les que surten d'aquell punt de recollida, i les que surten d'un punt de recollida que quedi **aigües avall** dins del recorregut d'alguna d'aquelles (injectors en sèrie) |
| Al port `output2` d'una **tolva filtre** (el connector de dalt de tot) | **aspiració** | les que **acaben** en aquella tolva filtre, que és el punt de consum |
| De qualsevol altra manera | cap | cap; el distintiu del diagrama ho diu i la fitxa explica com s'ha de connectar |

L'associació és **derivada de la topologia**, igual que les línies:
`assignPumpsToLines()` s'executa al final de `findTransportLines()` i deixa
`line.pumpIds` i `line.pumpNames` (ordenades pel nom). **No es desa mai.**
L'únic que es desa d'una bomba és el **nom**, a `store.elements[id]` amb la
fitxa de tipus `pump`.

La regla dels injectors en sèrie es resol amb el recorregut que cada línia
ja porta: `downstream` és, per a cada punt de recollida, el conjunt
d'elements que apareixen als recorreguts de les seves línies. Una bomba
d'impulsió al punt P serveix una línia si el punt de recollida d'aquesta
línia és P o és dins d'aquell conjunt.

**El nom s'assigna en néixer la bomba** (`createElementInstance`), amb el
primer `Bomba N` lliure, perquè es veu al diagrama i al panell de línies
abans que ningú n'obri la fitxa. A partir d'aquí és de l'usuari i no es
torna a tocar.

**Les línies ja no tenen nom.** El camp va desaparèixer de l'esquema
(`SCHEMAS.line`) i el seu lloc a la interfície el fan servir les bombes; el
que identifica una línia és el seu número. A la simulació, `line.name` de
l'escenari és `Línia N` i `line.pumps` porta els noms de les bombes. El
motor afegeix l'avís **`line-without-pump`** (no bloqueja) per a les línies
usades per la seqüència que no en tenen cap.

Els noms de línia desats per versions anteriors es queden a l'arxiu sense
fer nosa: `writeEntry()` només escriu les claus de l'esquema, i cap pantalla
no els llegeix.

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

El construeix **`buildSimulationScenario()`** a `script.js` (§8.1). La
correspondència entre l'escenari i el projecte és aquesta:

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

**El barrido pot portar línia però continua sense moure res.** El motor no
la mira: `collectErrors()` surt abans d'arribar-hi per als tipus que no
mouen producte, i `buildAction()` genera un tram sense moviment. La línia
només arriba al resultat (`compiled.actions[].lineId`) perquè la capa visual
pugui ensenyar quina canonada s'està netejant (§9.3). **Cap quilo de cap
element no pot dependre d'un barrido**, i hi ha una prova que ho comprova
comparant una seqüència amb barridos i la mateixa sense.

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
| `line-without-pump` | Una línia que fa servir la seqüència no té cap bomba bufadora que la pugui fer funcionar (§4b). |
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

## 8. La interfície de simulació (`script.js`)

Dona pantalla al motor. **Aquí no s'hi calcula res**: el bucle de
reproducció només fa avançar un rellotge i, a cada pas, li demana l'estat al
motor. Si algú es troba multiplicant quilos dins d'aquest codi, ha agafat el
camí equivocat.

Tot viu en una sola secció de `script.js`, marcada
`// ---- Interfície de simulació ----`, al final del fitxer.

### 8.1 El pont: `buildSimulationScenario()`

Converteix el diagrama i el model de procés en l'escenari pla de §6.1. És
l'**únic** lloc que sap com es diu cada cosa a les dues bandes: el motor no
sap res del diagrama i el diagrama no sap res del motor.

Es crida des de `refreshSimulation()` i enlloc més.

### 8.2 Quan es compila

`refreshSimulation()` refà l'escenari i la compilació. Es crida:

- en obrir el panell,
- en prémer **Play** (el que es reprodueix és sempre el diagrama i la
  seqüència d'ara),
- des de `refreshSimulationIfOpen()`, que va enganxat al final de
  `pushHistory()` i de `restoreState()`. Així qualsevol cosa que canviï el
  projecte —moure un element, configurar una línia, editar la seqüència,
  desfer, refer o obrir un arxiu— refà la simulació si el panell és obert.

**Mai** es compila a cada imatge ni en moure el cursor: arrossegar només
consulta la compilació que ja hi ha.

### 8.3 El bucle de reproducció

```js
let simTime = 0;        // segons de simulació
let simPlaying = false;
const SIM_SECONDS_PER_REAL_SECOND = 60;   // 1 s real = 1 min simulat a 1x
```

`simTick(now)` fa servir el **temps real transcorregut** entre imatges
(`now - simLastFrame`), no un comptatge d'imatges: així el resultat no depèn
de la potència de l'ordinador ni de si el navegador va just.

```js
simTime += (now - simLastFrame) / 1000 * SIM_SECONDS_PER_REAL_SECOND * velocitat;
```

La velocitat **només** multiplica aquesta línia. Els números d'un instant
donat no en depenen mai, perquè els dona `stateAt()`, que és una funció pura
de (compilació, instant).

Funcions: `playSimulation()` (compila i arrenca), `startPlaybackLoop()`
(arrenca sense compilar, per reprendre després d'arrossegar),
`pauseSimulation()`, `stopSimulation()` (pausa i torna a zero).

### 8.4 On viu l'estat de reproducció

En variables de mòdul de `script.js`, **fora** del model de procés i fora
del motor: `simScenario`, `simCompiled`, `simTime`, `simPlaying`,
`simFrameId`, `simLastFrame`, `simScrubbing`, `simResumeAfterScrub`.

Res d'això es desa ni toca el projecte. **Stop** el descarta tornant a zero;
el model de procés no s'ha tocat en cap moment.

### 8.5 El cursor arrossegable

La pista sencera (`#sim-track`) és la zona clicable. Amb `pointerdown` es
captura el punter, amb `pointermove` es va posant el temps i amb `pointerup`
es deixa anar.

Mentre s'arrossega, **el rellotge no avança**: si estava reproduint es posa
en pausa i es guarda a `simResumeAfterScrub` per reprendre en deixar-lo. Així
el bucle i el dit no es barallen.

També respon al teclat: fletxes (±5 s), Re Pàg/Av Pàg (±1 min), Inici i Fi.

### 8.6 Què es repinta i quan

| Funció | Quan | Què fa |
| --- | --- | --- |
| `renderSimIssues()` | a cada compilació | errors (bloquegen) i avisos (no bloquegen) |
| `renderSimSequence()` | a cada compilació | la taula de la seqüència |
| `renderSimTimeline()` | a cada compilació | blocs i marques del cronograma |
| `buildSimStateShell()` | a cada compilació | les files de l'estat del sistema, buides |
| `renderSimNow()` | **a cada imatge** | rellotge, cursor, acció actual i valors |

`renderSimNow()` és l'única que s'executa seixanta cops per segon, i només
canvia **textos** de nodes que ja existeixen (`simFactNodes`,
`simValueNodes`). No reconstrueix DOM: si ho fes, faria saltar les barres de
desplaçament i aniria a batzegades.

### 8.7 L'editor de seqüència

Les files surten de `ProcessModel.getSequence()`. Qualsevol canvi passa per
`commitSequence(actions)`, que desa al model i crida `pushHistory()`: la
seqüència entra a l'historial com qualsevol altra acció, o sigui que
**editar-la es pot desfer**.

Per què una línia no es pot fer servir ho diu `simLineProblems(lineId)`, que
**ho pregunta al motor** validant una seqüència d'una sola acció de
transport amb aquella línia. Així el motiu és exactament el mateix que veurà
l'usuari en prémer Play, i la interfície no repeteix cap regla del motor.

Les línies amb problemes surten desactivades al desplegable amb el motiu al
tooltip, i el motiu també s'escriu a la columna «Estimació». **Al barrido
no**: com que no mou producte, qualsevol línia li val, i també pot no tenir-ne
cap.

#### Nom per defecte d'una línia

En obrir la fitxa d'una línia **que no s'ha configurat mai**,
`openLineProcessPanel()` hi posa `Línia N`, amb el número que la línia té ARA
al panell lateral.

És **un valor de partida, no un nom automàtic**: un cop desada la fitxa, el
nom és de l'usuari i no es torna a tocar mai. Per això un recàlcul que canviï
els números visibles **no renomena cap línia ja configurada**: el nom que hi
ha desat ja no és el per defecte. La condició és `!ProcessModel.hasLine(...)`
i prou.

### 8.8 Mida i posició del panell

El panell pot estar **ancorat** a baix o **desancorat**, convertit en una
finestra flotant. No hi ha cap sistema de finestres: és el mateix element de
sempre amb una classe més (`.sim-panel--floating`) i quatre propietats
d'estil. Res del que hi ha a dins no se n'assabenta.

L'estat viu a `simPanelLayout` `{ floating, height, width, left, top }` i
l'estil del panell **sempre** en surt, via `applySimPanelLayout()`: no hi pot
haver dues veritats.

| Element | Què fa |
| --- | --- |
| `#sim-resize` | Vora superior. Ancorat, canvia l'alçada; desancorat, mou la vora de dalt i deixa la de baix on era. També respon a les fletxes del teclat. |
| `#sim-grip` | Cantonada de baix a la dreta: amplada i alçada alhora. Només visible desancorat. |
| `.sim-bar` | Desancorat, és per on s'agafa la finestra per moure-la. |
| `#sim-dock` | Ancora i desancora. |

`simPanelDrag(handle, className, onMove)` és l'arrossegament genèric que
comparteixen tots tres: `pointerdown`, moure, deixar anar. La captura del
punter va dins d'un `try`: si el navegador no la dona, l'arrossegament
continua funcionant.

**Límits.** Alçada mínima 220 px; ancorat, màxima `innerHeight − 160` perquè
sempre quedi diagrama a la vista. Desancorada, `clampFloatingPosition()`
garanteix que **la barra del títol no pot sortir mai de la pantalla**: és on
hi ha Play, Pausa, Stop i el botó de tancar. També es torna a aplicar quan es
canvia la mida de la finestra del navegador.

**Es recorda** a `localStorage`, amb la clau `pid-editor.sim-panel`, dins
d'un `try/catch`: si el navegador no deixa escriure-hi (finestra privada,
permisos), simplement no es recorda entre sessions i no passa res més.

**Les quatre columnes no es reorganitzen mai.** Cadascuna té una amplada
mínima per sota de la qual deixaria de llegir-se i, si el panell és més
estret que la suma, la fila es desplaça de costat. Apilar-les deixaria la
taula sense alçada, que és pitjor.

### 8.9 Durades i format

L'usuari escriu **minuts**; es desa en **segons** (`minuts * 60`). El temps
es mostra `mm:ss` amb `formatClock()`, i els quilos amb un decimal via
`ProcessModel.formatKg()`.

## 9. La capa visual sobre el diagrama (`script.js`)

Dibuixa sobre el diagrama el que el motor diu que hi ha. Com la resta de la
interfície de simulació, **no calcula res**: tot surt de l'estat que retorna
`SimulationEngine.stateAt()`.

Viu a la secció `// ---- Capa visual de la simulació ----`, al final de
`script.js`.

### 9.1 On es dibuixa: `#sim-overlay`

Un `<g>` **germà** del `#viewport`, no fill seu, penjat directament del
`<svg>`. Tres raons:

1. El que s'hi dibuixa **no entra a `viewport.getBBox()`**, i per tant no
   desquadra «Enquadra-ho tot».
2. Es pot **buidar sencer** sense tocar ni un node del diagrama.
3. Porta `pointer-events: none`, així que **no pot interferir** amb la
   selecció, l'arrossegament ni cap altra interacció de l'editor.

`applyViewport()` li posa **el mateix transform** que al viewport, de manera
que el que hi ha dibuixat es mou i s'escala amb el diagrama.

### 9.2 Barres de nivell

Es dibuixen **dins de la caixa del dibuix** de cada element: un farciment
translúcid que puja des de baix, la ratlla del nivell i, a sota, els quilos
i el percentatge.

- **Quina caixa.** `elementDrawingBox(element)` uneix les caixes dels traços
  de l'element **descartant els punts de connexió i el distintiu de rol**,
  que sobresurten de la forma. Té en compte la reducció de mida interna
  (`applyShapeScale`) i la rotació.
- **A quins elements.** Només als que **participen de debò**: els magatzems
  i els punts de consum de les línies que fa servir alguna acció de la
  seqüència (`simParticipants()`). La resta del diagrama es queda neta.
- **Percentatge honest.** `simLevelRatio()` retorna `null` si no hi ha
  capacitat definida; llavors la barra es queda buida i només parlen els
  quilos, amb el text «sense capacitat». **No s'inventa mai cap 100 %.**
- **Estats.** `.sim-bar--empty` quan arriba a 0 kg (contorn discontinu i
  vermell) i `.sim-bar--over` quan un punt de consum passa de la seva
  capacitat (barra clavada al 100 % i pintada d'avís).
- **Llegibilitat amb zoom.** Les etiquetes van dins d'un `<g>` amb
  `scale(1 / viewScale)`, de manera que tenen **mida fixa de pantalla**
  sigui quin sigui el zoom. `updateSimLabelScale()` ho refà des de
  `applyViewport()`.

`buildSimBars()` munta l'estructura (a cada compilació) i `renderSimBars()`
només en canvia els números i les alçades (a cada imatge).

### 9.3 Línia activa

`renderSimActiveLine(lineId)` posa `.pipe-path--active` a les canonades del
recorregut i `.pid-element--active` als seus elements.

**Són classes pròpies, diferents de les `--highlight` del panell de línies.**
És a posta: així el ressaltat que l'usuari hagi fixat al panell i el de la
simulació poden conviure, i aturar la simulació no n'esborra cap.

El recorregut el dona `simLineRoutes[lineId]`, que `buildSimulationScenario()`
omple amb els objectes de `findTransportLines()`. No entra a l'escenari
perquè el motor no en fa res.

**Quina línia es destaca** ho decideix `simActiveVisual(state)`:

- si el motor dona `state.activeLineId`, és un **transport** → mode
  `'product'`;
- si no, però l'acció actual és un **barrido amb línia** i encara no s'ha
  acabat → aquella línia, mode `'sweep'`.

El motor no marca el barrido com a actiu (no mou producte, i això no es toca);
la línia arriba igualment a `compiled.actions[].lineId` i és el que permet
ensenyar la canonada que s'està netejant.

### 9.4 Flux del producte

Partícules recorrent les canonades de la línia activa, en el sentit
recollida → consum.

`buildSimFlowChain(lineId)` encadena els `<path>` de les canonades del
recorregut i, per a cadascuna, mira si s'ha de recórrer endavant o enrere
comparant `pipe.from.element` amb l'ordre del recorregut. Després
`simFlowPoint()` fa servir `getPointAtLength()` per situar cada partícula.

**Límits de rendiment (tots deliberats):**

**Mida constant de pantalla.** El radi i el gruix del traç es divideixen pel
zoom (`SIM_DOT_RADIUS / viewScale`), de manera que les partícules es veuen
igual de grosses tant si mires un element de prop com tot el projecte de cop
— que és justament quan més falta fa que es vegin. Es recalcula a cada
repintat i també des de `updateSimOverlayScale()`, que penja
d'`applyViewport()` i per tant salta a cada pan i a cada zoom.

**Dues menes de partícula.** `renderSimFlow(lineId, mode)`: `'product'`
(fosques, transport) i `'sweep'` (blanques amb contorn fosc, barrido).
Canviar de línia **o de mode** les torna a crear.

| Límit | Valor | Per què |
| --- | --- | --- |
| Partícules per línia | `SIM_MAX_PARTICLES` = 22 | sostre dur, independentment de la llargada del recorregut |
| Separació | `SIM_FLOW_SPACING` = 70 unitats | poques partícules en recorreguts curts |
| Mida | `SIM_DOT_RADIUS` = 4,5 px de pantalla | visible a qualsevol zoom |
| Línies animades alhora | 1 | l'execució és seqüencial: només hi ha una acció activa |
| Amb `prefers-reduced-motion` | 0 | no es crea cap partícula |
| Amb la reproducció aturada | no avancen | la fase només creix a `simTick()` |
| Amb la pestanya amagada | la reproducció es posa en pausa | vegeu §9.7 |

La fase avança amb el **temps real**, no amb el de simulació: si anés amb el
segon simulat, a 10x seria una ratlla borrosa i a 0,25x semblaria aturada.

Mesurat sobre el model d'exemple de 49 elements i 51 canonades, amb 7 barres
i 6 accions: **~3,3 ms per imatge**, molt per sota dels 16,7 ms que deixen
els 60 per segon.

### 9.5 Informació en passar el ratolí

`canvas` escolta `mousemove` i, **només amb la simulació aturada o en
pausa** (mentre es reprodueix els números ja canvien sols i una etiqueta que
els persegueix fa nosa), ensenya `#sim-tip` amb el que diu el motor:

- magatzem o punt de consum → producte, quantitat, capacitat, nivell %;
- canonada → nom de la línia, rendiment, estat, temps acumulat i producte
  transferit.

Una canonada que no forma part de cap línia detectada no dona etiqueta.

### 9.6 Resum

`buildSimSummary(state)` retorna una **estructura plana** pensada per
convertir-se en un informe més endavant:

```js
{
  totalDuration, elapsed, totalTransported,
  lines:        [ { id, name, transferred } ],
  storages:     [ { id, name, remaining, capacity } ],
  consumptions: [ { id, name, received, capacity } ],
  incidents: { emptied: [...], overCapacity: [...], incomplete: [...] },
}
```

Tot surt de `stateAt()` i de `compiled.actions`. Les incidències són les que
**ja han passat en aquest instant**, no les de tota la seqüència, de manera
que el resum quadra sempre amb el que es veu a la pantalla.

`renderSimSummary()` el pinta. **No hi ha cap exportació**, a posta.

### 9.7 Com es restaura l'aspecte normal

`clearSimVisuals()` treu totes les barres, les partícules i les classes
`--active`. Es crida en tancar el panell i quan la compilació falla.

Com que tot el dibuix viu a `#sim-overlay` i les úniques marques al diagrama
són dues classes, **tancar la simulació deixa el `viewport` exactament com
estava**. Hi ha una prova que ho comprova comparant l'HTML del viewport
abans i després.

A més, `visibilitychange` posa la reproducció **en pausa** quan s'amaga la
pestanya: el navegador deixa de donar imatges i, si no es fes, en tornar-hi
el primer salt de temps seria enorme.

## 10. Format de guardat

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
    "process": {
      "elements": { ... },
      "lines": { ... },
      "sequence": [ { "order": 1, "type": "transport", "lineId": "...", "duration": 420 } ]
    }
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

La **seqüència** (§3.2) es va afegir a `state.process.sequence` sense pujar
la versió: és un camp opcional i els arxius que no en porten obren amb la
seqüència buida, que és el que toca.

Quan una etapa futura necessiti un canvi que trenqui alguna cosa: pugeu
`FILE_VERSION` i afegiu `MODEL_MIGRATIONS[n]`. `migrateModel()` les encadena
totes.

---

## 11. La interfície de configuració (`script.js`)

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

## 12. Regles que no s'han de trencar

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
13. **La interfície de simulació no calcula res.** Tot número que es veu
    ve de `stateAt()` o de `compiled.actions`. El bucle només mou un
    rellotge.
14. **La simulació no modifica mai el projecte.** Ni el model de procés ni
    el diagrama. Stop només torna el rellotge a zero.
15. **La velocitat no pot alterar el resultat**: només multiplica la
    rapidesa amb què avança `simTime`.
16. **No es compila a cada imatge ni en moure el cursor.** Vegeu §8.2.
17. **La capa visual es dibuixa fora del `viewport`**, a `#sim-overlay`, amb
    `pointer-events: none`. Res del que hi ha dibuixat pot interferir amb
    l'editor ni sobreviure al tancament del panell.
18. **Els percentatges són honestos**: sense capacitat definida no se
    n'inventa cap (§9.2).
19. **El ressaltat de la simulació té classes pròpies** (`--active`),
    diferents de les del panell de línies (`--highlight`). No es barregen.

---

## 13. Paranys coneguts

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
- **La seqüència guarda la signatura de la línia** (§4), no el seu número.
  Si es refà el diagrama de manera que la línia deixi d'existir, l'acció es
  queda apuntant a una línia que ja no hi és i el motor ho diu amb
  `missing-line`. És el comportament correcte, però convé saber-ho.
- **`refreshSimulationIfOpen()` penja de `pushHistory()`**, que es crida
  després de cada acció de l'usuari. Només fa feina si el panell és obert;
  si algun dia es fes servir per a alguna cosa més cara, caldrà repassar-ho.

---

## Què NO hi ha

Res d'això existeix, ni tan sols començat, i no s'ha de donar per fet:

- **Exportació del resum**: informes, PDF, impressió. L'estructura hi és
  (§9.6), la sortida no.
- Guardar els resultats d'una simulació a l'arxiu.
- Física de barrido i posada a règim (§6.5).
- Accions simultànies o en paral·lel a la seqüència.
- Càlcul de pressions o de cabals a partir del diàmetre i la longitud, que
  es desen però encara no es fan servir per a res.
- Accions en paral·lel. L'execució és estrictament seqüencial. Els trams
  porten inici i final **absoluts**, de manera que el dia que calgui
  permetre solapaments el que canviarà és com es decideixen aquests
  inicis, no la resta del motor.

### Idees per a més endavant

Anotades pel camí i **no** implementades a propòsit:

- Exportar el resum (§9.6 ja deixa l'estructura a punt).
- Poder posar nom als elements sense rol.
- Avisar quan un punt de consum sense producte rep de dos magatzems amb
  productes diferents (§13).
- Un avís propi a la llista quan una acció queda incompleta (avui es veu al
  cronograma, a la columna «Estimació» i al resum, però no entre els avisos
  del motor).
- Duplicar una acció de la seqüència, i reordenar-la arrossegant les files
  en comptes d'amb les fletxes.
- Que la barra de nivell segueixi la silueta real de l'element (avui fa
  servir la caixa del seu dibuix, §9.2), amb un `clipPath` per element.
- Marcar al cronograma l'instant exacte en què cada magatzem es buida: el
  motor ja el dona a `compiled.keyTimes`.
- Fer servir el diàmetre i la longitud de les línies per a alguna cosa: avui
  es desen i es mostren, però cap càlcul no en depèn.
- Donar feina de debò a les bombes (§4b): avui el programa només sap **quina
  bomba pot moure cada línia**. Triar-la durant la simulació, el cabal o la
  pressió que dona, la potència, el consum i les restriccions de
  funcionament simultani entre bombes estan tots per fer.
- Donar física al barrido: avui ja sap per quina línia es fa (§9.3), o sigui
  que arrossegar el producte que queda a la canonada seria el pas natural.
  Es començaria per `MOVES_PRODUCT` a `simulation.js` (§6.5).
- Recordar també quines línies de transport tenia fixades el panell lateral,
  ara que el de simulació ja recorda mida i posició (§8.8).
