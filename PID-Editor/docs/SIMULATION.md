# Capa de dades de procés

Document de referència per a qui continuï el projecte sense haver vist com
es va fer. Descriu **què hi ha ara mateix** a la capa de dades de procés de
l'Editor P&ID, on viu cada cosa i quines regles no s'han de trencar.

Escrit en acabar l'**etapa 4**, l'última del pla, i posat al dia després
dels afegits que hi ha vingut després (bombes bufadores i cronograma en
paral·lel):

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
- **Després** — **bombes bufadores** (§4b) i **cronograma en paral·lel**:
  una fila per bomba, accions amb instant d'inici propi, diverses línies
  treballant alhora i detecció de xocs de bomba i de canonada (§3.2, §6.6,
  §8.5, §8.7).
- **I després** — el **cronograma com a eina d'edició**: les bombolles es
  mouen, s'allarguen, canvien de fila, es trien, es copien i s'enganxen, i
  els problemes es marquen a sobre mentre es treballa (§8.5b).

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

Una seqüència és una llista d'accions **col·locades en el temps**. Cada
acció la fa **una bomba** i comença en un **instant explícit**, de manera que
diverses accions **poden anar alhora** mentre siguin de bombes diferents i no
comparteixin cap tram de la instal·lació. Viu a `ProcessModel`
(`getSequence()` / `setSequence()`); qui l'executa és el motor (§6).

```js
{ order: 1, type: 'transport', pumpId: 'pump-4', lineId: '<signatura de línia>',
  startTime: 0, duration: 600 }
```

| Camp | Què és |
| --- | --- |
| `id` | Identificador **estable**: no canvia mai mentre l'acció existeixi. L'assigna `normalizeSequence()` a qui no en porti. És el que fa servir el cronograma per saber què hi ha triat i què s'està arrossegant (§8.5b); l'`order`, que es renumera a cada moviment, no serviria. |
| `order` | Número que es veu a la taula i amb què el motor l'anomena als missatges. `normalizeSequence()` el renumera sol. |
| `type` | Un de `ProcessModel.ACTION_TYPES`: `transport`, `rest` (Descans), `sweep` (Barrido), `startup` (Posada a règim). |
| `pumpId` | La **bomba bufadora** que fa l'acció (§4b). És la seva fila al cronograma. Buit vol dir «encara sense bomba»: es pot simular igualment, però surt a la fila «Sense bomba». |
| `lineId` | La línia de transport (la seva **signatura**, §4). **Obligatòria** a les accions de transport i **opcional** al barrido, on només diu per quina canonada es fa la neteja. Als altres tipus s'ignora. |
| `startTime` | **En segons** des del començament de l'operació. A la pantalla s'escriu en minuts. |
| `duration` | **En segons**, sempre més gran que 0. A la pantalla es veurà en minuts; el model no arrodoneix mai. |

`normalizeSequence()` ordena la llista **per `startTime`** (i, si empaten,
per bomba i per la posició que tenien) i tot seguit renumera `order`. O
sigui: la llista sempre es llegeix en ordre cronològic, i moure una acció en
el temps la reordena sola.

**`startTime: null` vol dir «arxiu d'abans del cronograma»**, i és l'única
manera de distingir-ho d'un zero de debò. Qui ho converteix és
`migrateSequenceToLanes()` a `script.js`, un sol cop en obrir l'arxiu (§10).

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

El distintiu del diagrama porta **només el nom, abreujat** (`Bomba 3` → `B3`;
un nom propi s'ensenya tal com s'ha escrit). **No hi diu si treballa per
impulsió o per aspiració**, i és a posta: això depèn d'on està connectada i
canvia quan la mous, o sigui que un text enganxat a la forma es quedaria
desfasat de seguida. Aquesta informació surt a la **fitxa** de la bomba, que
es recalcula cada cop que s'obre.

**Les línies ja no tenen nom.** El camp va desaparèixer de l'esquema
(`SCHEMAS.line`) i el seu lloc a la interfície el fan servir les bombes; el
que identifica una línia és el seu número. A la simulació, `line.name` de
l'escenari és `Línia N` i `line.pumps` porta els noms de les bombes. El
motor afegeix l'avís **`line-without-pump`** (no bloqueja) per a les línies
usades per la seqüència que no en tenen cap.

Els noms de línia desats per versions anteriors es queden a l'arxiu sense
fer nosa: `writeEntry()` només escriu les claus de l'esquema, i cap pantalla
no els llegeix.

### Connectar canonades sense deixar-ne cap a mitges

Arrossegar des d'un punt de connexió per fer una canonada nova fa servir
**esdeveniments de punter amb captura** (`setPointerCapture`), igual que
moure un element. És important: amb els esdeveniments de ratolí, deixar anar
el botó fora de la finestra no arribava mai, i la línia discontínua de
previsualització es quedava dibuixada **per sempre** — sense poder-la
seleccionar ni esborrar, perquè no és cap element de debò.

Tres xarxes de seguretat més, totes a `cancelPendingPipe()`:

- començar un arrossegament nou tanca el que hi pugui haver a mitges;
- **Escape** i `pointercancel` el cancel·len;
- `clearAll()` i `restoreState()` també, i en acabar s'escombra qualsevol
  `.pipe-path--preview` que hagi pogut quedar orfe.

I un detall d'ús: prémer i deixar anar sobre un punt de connexió ja connectat
canvia la direcció d'aquell extrem, però **només si el cursor no s'ha mogut**
(`CONNECT_DRAG_SLOP`). Abans, intentar arrossegar des d'un punt ja connectat
afegia un tram a la canonada existent sense voler.

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
      name: 'Línia 1', throughput: 600,  // kg/h
      configured: true,                  // opcional; false = encara no configurada
      pickupId: 'injector-5', pickupName: 'Injector - P1',
      consumptionId: 'hopper-8',
      storageId: 'silo-3',
      storageStatus: 'found',            // 'found' | 'chosen' | 'ambiguous' | 'none'
      pumpIds: ['pump-4'],               // bombes que la poden fer funcionar
      route: {                           // per on passa, per detectar-hi xocs
        elements: ['injector-5', 'diverter-2', 'hopper-8'],
        connectors: ['pipe-11', 'pipe-12'],
        labels: { 'injector-5': 'Injector - P1', 'hopper-8': 'Amassadora' },
      },
    },
  },
  pumps: {
    'pump-4': { name: 'Bomba 1', mode: 'push' },   // 'push' | 'suction' | ''
  },
  actions: [ /* vegeu §3.2 */ ],
}
```

**`route` és el que fa possible detectar els xocs** (§6.6): hi ha d'haver
**tots** els elements pels quals passa la línia, els dos extrems inclosos
(Pickup Point i punt de consum). `labels` només serveix per poder escriure
missatges que un enginyer entengui («totes dues passen per "Desviadora - D2"»).

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

1. `compile()` fa una **escombrada d'esdeveniments**. Els moments clau de
   partida són l'inici i el final de **cada** acció; com que ara n'hi pot
   haver de simultànies, a cada tram s'hi mira **quines accions són vives**
   i quins fluxos hi ha en marxa.
2. Quan **diverses línies treuen del mateix element d'emmagatzematge**, el
   cabal de sortida d'aquell element és la **suma** dels cabals. L'instant
   en què es buida surt de dividir la massa que queda **per aquesta suma**,
   no per cap cabal solt: `segons = kg · 3600 / (Σ kg/h)`. Aquest instant és
   un moment clau més i talla el tram.
3. El que s'ha tret d'un element es reparteix entre les línies que hi
   estiraven **en proporció al seu cabal**, amb una excepció escrita a
   posta: si només n'hi havia una, se li dona **exactament** tota la massa
   treta, sense passar per cap multiplicació ni divisió. Així el cas normal
   (una línia sola) continua donant números rodons.
4. Entre dos moments clau consecutius **tot varia de manera perfectament
   lineal**. Cada tram guarda la situació **exacta al seu inici** i el
   cabal de cada element durant el tram.
5. `stateAt()` és llavors: trobar el tram i interpolar.

L'escombrada té un sostre dur de trams (`MAX_SEGMENTS`), que no s'hauria
d'assolir mai: amb N accions i M magatzems no en poden sortir més de
2N+M+1. Hi és perquè, si algun dia s'hi afegeix una condició que es
realimenti, el programa es quedi penjat **no** sigui una opció.

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
    index, startTime, endTime,
    actionOrders: [1, 4],          // TOTES les accions vives en aquest tram
    movingLineIds: ['<sig A>', '<sig B>'],
    moving,                        // true si alguna línia mou producte
    storages:     { id: { start, ratePerHour, rate } },   // rate negatiu
    consumptions: { id: { start, ratePerHour, rate } },
    lines:        { id: { start, ratePerHour, rate } },   // kg acumulats per línia
  } ],
  actions: [ {
    order, type, pumpId, lineId, startTime, endTime, duration, moving,
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
  actions: [ { order, type, pumpId, lineId, startTime, endTime, duration,
               progress, complete, incompleteReason } ],   // TOTES les vives ara
  activeLineIds: ['<sig A>', '<sig B>'],   // buit si no es mou res
  storages:     { id: kg },
  consumptions: { id: kg },      // kg acumulats (quantitat inicial inclosa)
  lines:        { id: kg },      // kg transferits per aquella línia
  warnings: [ ... ],             // només els que ja han passat (atSeconds <= time)
}
```

`actions` i `activeLineIds` són **llistes** perquè amb diverses bombes hi pot
haver més d'una acció en marxa al mateix instant. Van ordenades per `order`,
de manera que el que es veu per pantalla no balla d'una imatge a l'altra.

El temps demanat es retalla a `[0, totalDuration]`: consultar abans del
començament o després del final no dispara mai. `totalDuration` és **el
final de l'última acció**, no la suma de durades: dues accions de 5 minuts
que van alhora duren 5 minuts, no 10.

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
| `pump-conflict` | Dues accions de **la mateixa bomba** se solapen en el temps. Una bomba no pot fer dues coses alhora. |
| `pipe-conflict` | Dues accions de **bombes diferents** se solapen i **comparteixen algun element del recorregut** (extrems inclosos). Dues coses alhora no poden passar pel mateix tram. |

**Com es detecten els xocs** (`collectConflicts()` a `simulation.js`): es
comparen totes les parelles d'accions; si les seves finestres de temps no es
toquen, no hi ha res a mirar. Si es toquen i són de la mateixa bomba, és
`pump-conflict` i s'acaba aquí. Si són de bombes diferents, es comparen els
**elements** dels dos recorreguts (`line.route.elements`): si en comparteixen
cap, és `pipe-conflict`. Els connectors no s'han de comparar a part —si dues
accions comparteixen una canonada, també en comparteixen els dos elements
dels extrems.

Quins tipus d'acció ocupen la canonada ho diu la taula `OCCUPIES_PIPE`:
**transport i barrido sí** (l'un hi passa producte i l'altre hi passa aire, i
tots dos la volen per a ells sols); **descans i posada a règim no**, que
només ocupen la bomba. Per això dues accions que no ocupen canonada mai no
poden donar `pipe-conflict`, però sí `pump-conflict` si són de la mateixa
bomba.

Els dos missatges diuen **quines accions** xoquen, **de quina bomba** són,
**de quin minut a quin minut** i, al `pipe-conflict`, **per quins elements**
passen totes dues (fins a tres noms i «i N més»). L'error porta també
`actionOrder`, `otherOrder`, `fromSeconds`, `toSeconds` i, si escau,
`sharedElementIds`, que és el que fa servir la interfície per marcar les
files i els blocs (§8.7).

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
`RESUM: 47 proves, totes correctes.`. Per tornar-les a executar, F5.

No cal instal·lar res: el projecte no té build ni gestor de paquets, i la
pàgina carrega `process.js` i `simulation.js` **de debò**, no una còpia.

| Fitxer | Què és |
| --- | --- |
| `tests/tests.html` | La pàgina que s'obre. |
| `tests/runner.js` | Executor mínim: `Test.group()`, `Test.case()` i les comprovacions. |
| `tests/simulation.test.js` | Les proves del motor. |

A banda hi ha una bateria de regressió de l'aplicació sencera que es munta
fora del projecte (carrega `index.html` amb una sonda enganxada al final i
compta comprovacions). No es desa al repositori perquè depèn de l'entorn de
qui la munta; el que sí que és al repositori és el que compta: el motor.

Entre els grups n'hi ha dos que guarden les regles del cronograma en
paral·lel i que **no s'han de deixar caure**: «Accions en paral·lel»
(diverses línies alhora, suma de cabals des del mateix magatzem i instant
exacte en què es buida) i «Conflictes entre accions simultànies»
(`pump-conflict`, `pipe-conflict` i els casos que **no** han de xocar:
descans i posada a règim, que no ocupen canonada).

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

### 8.5 El cronograma i el cursor arrossegable

El cronograma és un **diagrama de Gantt**: una **fila per bomba**
(`simLanes()`), totes compartint el mateix eix de temps, més una fila
«Sense bomba» que només surt si hi ha alguna acció sense assignar. A
l'esquerra de cada fila hi ha el nom de la bomba i **quant per cent de
l'operació treballa**; la pista ratllada és el temps mort i els blaus, les
accions.

Els blocs es col·loquen en tant per cent de `simTimelineDuration()`, que és
el **final de l'última acció**. Un bloc amb conflicte es pinta en vermell
(`.sim-block--conflict`).

L'amplada de la columna d'etiquetes és el token CSS `--sim-lane-label` i
està duplicada a `script.js` com a `SIM_LANE_LABEL`. **Si canvieu l'una,
canvieu l'altra**: és el que fa que el cursor, que travessa totes les files,
caigui al lloc.

La pista sencera (`#sim-track`) és la zona clicable. Amb `pointerdown` es
captura el punter, amb `pointermove` es va posant el temps i amb `pointerup`
es deixa anar.

Mentre s'arrossega, **el rellotge no avança**: si estava reproduint es posa
en pausa i es guarda a `simResumeAfterScrub` per reprendre en deixar-lo. Així
el bucle i el dit no es barallen.

També respon al teclat: fletxes (±5 s), Re Pàg/Av Pàg (±1 min), Inici i Fi.

### 8.5b El cronograma com a eina d'edició

La seqüència es pot replantejar directament sobre les bombolles, sense
passar per la taula. **Tot acaba al mateix lloc**: `ProcessModel.setSequence()`.
El cronograma no calcula res pel seu compte, i per això els quilos surten
idèntics s'editi per on s'editi.

#### Què es pot fer

| Gest | Què fa |
| --- | --- |
| Arrossegar el cos d'una bombolla | canvia **quan comença** |
| Arrossegar-ne una vora | canvia **quant dura** (l'altra vora es queda) |
| Arrossegar-la a una altra fila | la canvia **de bomba** |
| Clic | la tria |
| Ctrl+clic | l'afegeix o la treu de la tria |
| Ctrl+C / Ctrl+V / Ctrl+D / Supr | copia, enganxa, duplica, esborra |
| Ctrl+A | tria totes les accions |
| Botó dret | menú amb el mateix, més «Afegeix una acció aquí» |
| Alt mentre es mou | **ajust fi**: s'apaga la graella de temps |
| Escape | cancel·la l'arrossegament i ho deixa tot com era |

#### Decisions que no són òbvies

**El punter es captura a `#sim-lanes`, no al bloc.** El bloc es destrueix i
es torna a crear a cada repintat; si la captura hi fos, el primer repintat
trencaria l'arrossegament. `#sim-lanes` sobreviu a `replaceChildren()`.

**Cada moviment es calcula des de la seqüència d'abans de començar**
(`drag.origin`), mai des del resultat del moviment anterior. Això és el que
fa que el resultat depengui només d'on és el ratolí ARA, que tornar al punt
de partida ho deixi tot exactament com estava, i que apartar una acció es
desfaci sol si te'n vas.

**L'eix de temps es congela en prémer el botó**, amb un 25 % de marge a la
dreta. Si es tornés a ajustar a cada moviment, estirar l'última acció cap a
la dreta faria créixer l'eix, que faria que el mateix píxel volgués dir un
instant diferent, que la faria créixer una mica més: la bombolla fugiria del
dit. En prémer **no** es redibuixa el cronograma (només es repinta quin bloc
està triat, amb `simPaintSelection()`), de manera que un clic per triar no fa
saltar l'escala.

**Un clic no edita.** Mentre `drag.moved` és fals no s'escriu res al model:
sense aquesta condició, clicar una acció que comença al minut 2,283 la
desplaçaria tota sola fins a la graella més propera.

**Un arrossegament sencer és UN sol pas de «desfer».** Mentre dura, els
canvis passen per `ProcessModel.setSequence()` + `resimulateSequence()`, que
**no** toquen l'historial; en deixar anar es crida `pushHistory()` un cop.
Si no s'ha mogut res, o si s'ha cancel·lat amb Escape, no se'n desa cap.

**`resimulateSequence()` recompila canviant només la seqüència**, sense
tornar a llegir el diagrama. Refer l'escenari sencer (tornar a detectar
línies, bombes i recorreguts) a cada moviment del ratolí aniria a batzegades
i no cal: mentre s'arrossega una bombolla, del diagrama no se'n mou res.

**La graella de temps s'adapta al zoom**: es tria la més fina de
`SIM_SNAP_STEPS` que encara ocupi uns 8 px a la pantalla. A més, les vores de
les altres accions fan d'imant dins d'uns 7 px: encadenar-ne dues és el que
més es fa, i així n'hi ha prou d'acostar-les.

**Dins d'una fila dues accions no se solapen mai.** Ho garanteix
`simLayoutSequence()`: les arrossegades es queden on les deixes i la resta
s'aparten **cap endavant**, en cascada. S'empeny i no s'intercanvia perquè
empènyer conserva l'ordre en què l'usuari havia pensat les coses; i només
cap endavant, perquè fer-les recular ompliria forats que hi són a posta
(esperes entre tandes).

**Canviar de fila es pot rebutjar.** Si la bomba de destí no pot fer
funcionar la línia de l'acció (`line.pumpIds`), la fila es marca en vermell,
l'etiqueta flotant en diu el motiu i en deixar anar l'acció es queda on era.
La fila «Sense bomba» ho accepta tot.

**Moure'n diverses alhora** desplaça totes les triades el mateix temps.
El canvi de fila només es permet amb una acció sola: amb diverses, què
voldria dir «aquesta fila» no és evident, i endevinar-ho seria pitjor que no
fer-ho.

**Enganxar no trepitja res.** Cada acció torna a la seva bomba (o a la fila
apuntada, si només n'hi ha una) i es col·loca al **primer forat lliure** a
partir d'allà (`simFirstFreeSlot()`), conservant la distància que hi havia
entre les copiades. Si una va a parar a una bomba que no pot fer la seva
línia, s'avisa i **no** es col·loca.

### 8.5c Els dos marcatges de problema

Són **deliberadament diferents**, perquè d'una ullada es vegi de quina mena
és el problema. Tots dos surten del resultat del motor (`simActionMarks()`);
aquí no es decideix res, només com pintar-ho.

| | Xoc de canonada o de bomba | Falta de producte |
| --- | --- | --- |
| Marca | ratllat **diagonal vermell** sobre tot el bloc | ratllat **vertical ocre** sobre **el tros que es queda sense res** |
| Color | `--ui-danger` | `--ui-warn` |
| Classes | `.sim-block--conflict`, fila `tr.is-conflict` | `.sim-block--dry` (+ `--dry-all`), fila `tr.is-dry` |
| Play | **bloquejat** | **no** es bloqueja |
| Per què | dues coses alhora pel mateix lloc és impossible | quedar-se sense producte és una situació física real i el motor la sap tractar |

L'acció que **no pot ni començar** porta `--dry-all` i queda ratllada
sencera; la que **es queda a mitges** només ho està a partir de l'instant en
què el magatzem es buida, que surt del final de l'últim tram en què la seva
línia encara movia alguna cosa.

En passar el ratolí per sobre d'una bombolla surt l'explicació sencera
(`#sim-block-tip`): què és, de quin minut a quin, i el problema en llenguatge
planer. Als xocs el text el dona el **motor** (és el mateix que surt a la
safata d'avisos); a la falta de producte s'hi diu quants quilos calien,
quants n'hi havia i en quin minut s'esgota. Si el problema és un xoc de
canonada, **el tram compartit es ressalta també sobre el diagrama**
(`.pipe-path--clash` i `.pid-element--clash`), i es desmarca en treure el
ratolí.

Hi ha una **llegenda** fixa sota el cronograma amb el significat de cada
marca i els gestos principals, perquè no calgui recordar-se'n.

**Limitació coneguda:** mentre hi ha un xoc, el motor no calcula res, i per
tant no es pot saber si a més hi hauria falta de producte. Primer es resol
el xoc i llavors apareix l'altre avís, si n'hi ha.

### 8.6 Què es repinta i quan

| Funció | Quan | Què fa |
| --- | --- | --- |
| `renderSimIssues()` | a cada compilació | errors (bloquegen) i avisos (no bloquegen) |
| `renderSimSequence()` | a cada compilació | la taula de la seqüència |
| `renderSimTimeline()` | a cada compilació | blocs i marques del cronograma |
| `buildSimStateShell()` | a cada compilació | les files de l'estat del sistema, buides |
| `renderSimNow()` | **a cada imatge** | rellotge, cursor, acció actual i valors |
| `resimulateSequence()` | a cada moviment d'un arrossegament | recompila **només** amb la seqüència nova i repinta avisos, taula i cronograma |
| `simPaintSelection()` | en clicar una bombolla | només afegeix i treu la classe de triat: no mou res de lloc |

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

#### Bomba, inici i línies que es poden triar

Les columnes són `#`, `Bomba`, `Acció`, `Línia`, `Inici`, `Durada`,
`Estimació` i els botons.

- **El desplegable de línia només ensenya les línies que la bomba d'aquella
  acció pot fer funcionar** (`line.pumpIds.includes(action.pumpId)`). La que
  ja hi ha triada no s'amaga mai, encara que hagi deixat de ser vàlida: si
  no, no es podria ni veure ni canviar.
- **Canviar la durada arrossega les accions posteriors de la mateixa
  bomba**, conservant els forats que hi hagi entre elles. Sense això,
  allargar una acció xocaria immediatament amb la següent, que no és el que
  vol dir ningú quan només toca una durada. Les accions de les **altres**
  bombes no es mouen: cada fila és independent.
- **Inici i durada s'escriuen en minuts i es desen en segons.**
- **Al costat de la durada hi va el minut en què l'acció acaba**, en gris i
  sense poder-s'hi escriure (`.sim-row__ends`). L'encapçalament diu «Dura» i
  no «Durada» pel mateix motiu: la primera vegada, «Inici 0 / Durada 5» es
  pot llegir com «del minut 0 al 5», i amb «acaba al 5 min» a la vista el
  dubte desapareix sol.

#### Xocs: com es marquen i com es resolen

`simConflictingOrders()` treu del resultat del motor el conjunt d'`order`
implicats en algun `pump-conflict` o `pipe-conflict`. Amb això la interfície
pinta la fila (`tr.is-conflict`) i el bloc del cronograma
(`.sim-block--conflict`), i escriu «Xoca amb una altra acció» a l'estimació.
El **missatge sencer**, amb els noms i els minuts, el dona el motor i surt a
la safata d'avisos de dalt. Play queda bloquejat mentre n'hi hagi cap.

`suggestFreeStart(index)` proposa **el primer instant lliure**: prova el zero
i els finals de la resta d'accions —que són els únics instants on es pot
obrir un forat— i **torna a preguntar al motor** per cada candidat fins que
un no xoca. No hi ha cap regla repetida aquí: qui decideix si una col·locació
val és sempre `SimulationEngine.validate()`. Si en troba un, surt el botó
«Mou-la al minut N», que només canvia el `startTime` d'aquella acció.

#### El nom d'una línia

Una línia **no té camp de nom**: es diu sempre `Línia N`, amb el número que
té ARA al panell lateral. La fitxa de la línia només demana rendiment,
diàmetre i llargada, i ensenya quines bombes la poden fer funcionar (§4b).

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

**Quines línies es destaquen** ho decideix `simActiveVisual(state)`, que
torna una **llista** de `{ lineId, mode }` perquè amb diverses bombes n'hi
pot haver més d'una alhora:

- cada línia de `state.activeLineIds` és un **transport** → mode
  `'product'`;
- cada acció viva que sigui un **barrido amb línia** i encara no s'hagi
  acabat hi afegeix aquella línia, mode `'sweep'`.

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

**Dues menes de partícula.** `renderSimFlow(active)`: `'product'` (fosques,
transport) i `'sweep'` (blanques amb contorn fosc, barrido). Canviar de
línia **o de mode** les torna a crear.

**Diverses línies alhora.** `active` és la llista de línies que es veuen
treballar en aquest instant. Cada una té el seu joc de partícules a
`simFlows` (`lineId → { chain, nodes, mode }`); les que deixen d'estar
actives s'esborren i les noves es creen. El **pressupost de partícules es
reparteix** entre les línies actives (`SIM_MAX_PARTICLES / nombre de
línies`), de manera que el cost per imatge **no creix** encara que es facin
anar sis bombes alhora.

| Límit | Valor | Per què |
| --- | --- | --- |
| Partícules per línia | `SIM_MAX_PARTICLES` = 22 | sostre dur, independentment de la llargada del recorregut |
| Separació | `SIM_FLOW_SPACING` = 70 unitats | poques partícules en recorreguts curts |
| Mida | `SIM_DOT_RADIUS` = 4,5 px de pantalla | visible a qualsevol zoom |
| Línies animades alhora | les que treballin | el pressupost total de partícules es reparteix entre elles |
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

El pas a **cronograma en paral·lel** tampoc no ha pujat la versió, perquè
`pumpId` i `startTime` també són camps opcionals. La conversió es fa en
obrir l'arxiu, a `migrateSequenceToLanes()` (`script.js`):

- Les accions amb `startTime: null` —o sigui, les d'un arxiu antic— es
  **encadenen una darrere l'altra** tal com s'executaven abans: la primera
  al zero i cada una tot seguit de l'anterior. Una seqüència antiga, doncs,
  **fa exactament el mateix que feia**.
- Cada acció rep la **primera bomba de la seva línia** (`line.pumpIds[0]`);
  si la línia no en té cap, es queda a la fila «Sense bomba», que es pot
  simular igualment.
- Es fa **un sol cop**, en obrir, i el resultat es desa amb el projecte a la
  primera desada. Una seqüència que ja porta hores no es toca mai.

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
20. **Dues accions alhora no poden compartir cap tram de la instal·lació**,
    ni cap bomba. Ho decideix el motor, no la interfície, i bloqueja Play.
21. **Els xocs es decideixen sobre `line.route.elements`**, extrems
    inclosos. Qualsevol element nou que pugui formar part d'un recorregut hi
    ha de sortir, o passaran dues coses alhora pel mateix lloc sense que
    ningú ho digui.
22. **La durada total és el final de l'última acció, no la suma.** Sumar
    durades era correcte quan tot anava en fila; ara ja no ho és.
23. **Una seqüència antiga ha de continuar fent el mateix.** Qualsevol canvi
    a la conversió de §10 s'ha de comprovar amb un arxiu de debò.
24. **El cronograma és una altra manera d'editar, no un càlcul paral·lel.**
    Tot el que s'hi fa passa per `ProcessModel.setSequence()` i pel motor.
    Els quilos han de sortir idèntics s'editi per on s'editi, i hi ha una
    prova que ho comprova.
25. **Un arrossegament és un sol pas de «desfer»**, i un clic no n'és cap.
26. **L'`id` d'una acció no es pot derivar de l'`order`.** L'ordre canvia
    cada cop que una acció es mou en el temps; l'identificador, mai.
27. **Els dos marcatges de problema no es poden assemblar** (§8.5c): un
    bloqueja la reproducció i l'altre no, i confondre'ls és fer prendre una
    situació normal per una d'impossible.

---

## 13. Paranys coneguts

- **No capturis el punter al bloc del cronograma.** Es destrueix a cada
  repintat. La captura va a `#sim-lanes` (§8.5b).
- **No redibuixis el cronograma en prémer el botó del ratolí**: l'escala de
  temps es congela en aquell moment i el dibuix faria un salt visible a cada
  clic.
- **No apliquis la graella de temps fins que el ratolí no s'hagi mogut de
  debò**, o clicar una acció la desplaçarà.

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
- Càlcul de pressions o de cabals a partir del diàmetre i la longitud, que
  es desen però encara no es fan servir per a res.
- **Planificació automàtica**: ningú no col·loca les accions per tu ni
  optimitza l'ordre. L'única ajuda que hi ha és el botó «Mou-la al minut N»
  quan una acció xoca (§8.7), que proposa el primer forat lliure i prou.
- **Límit de cabal d'una bomba**: una bomba no pot fer dues accions alhora,
  però si en fa una no es comprova enlloc si li dona l'aire per al
  rendiment que demana la línia.
- **Recursos compartits que no siguin la canonada**: si dues línies
  depenen del mateix compressor, del mateix filtre o del mateix quadre
  elèctric i això no es veu al diagrama, el programa no ho pot saber.

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
