# EP Geometry Tool

## Co tento nástroj dělá
Webová aplikace pro energetické specialisty v ČR.
Uživatel nahraje naskenovaný půdorys jako obrázek, obtáhne zóny,
přiřadí konstrukce (včetně výplní – okna, dveře) a získá výstup
pro PENB výpočty.

## Klíčové výstupy
- Podlahová plocha (m²)
- Energeticky vztažná plocha (m²)
- Objem budovy (m³)
- Tabulka: konstrukce / plocha (m²) / U-hodnota (W/m²K)
- Export: CSV + gbXML v0.37 (kompatibilní s DesignBuilderem)

## Tok dat – jak aplikace funguje

1. Upload obrázku (sken, PDF screenshot) jako podklad na canvas
2. Uživatel nastaví měřítko: klikne 2 body → zadá skutečnou vzdálenost v metrech
3. Kreslení polygonů zón klikáním na canvasu
4. Zadání výšky podlaží → automatický výpočet objemu a hrubých ploch stěn
5. Přiřazení konstrukcí každé hraně polygonu přes průvodce (viz níže)
6. Export výsledků

## Logika hran polygonu – stěny a výplně

Každá hrana polygonu reprezentuje jednu stěnu. Stěna může obsahovat výplně
(okna, dveře) s odlišnými U-hodnotami. Výplně se NEkreslí na canvasu –
zadávají se číselně v panelu hrany.

### Výpočet plochy stěny
```
Hrubá plocha stěny = délka hrany × výška podlaží
Čistá plocha stěny = hrubá plocha − součet ploch výplní
```

### Datová struktura hrany
```typescript
interface Edge {
  id: string
  points: [Point, Point]         // souřadnice na canvasu
  lengthMeters: number           // přepočteno přes měřítko
  construction: Construction | null
  openings: Opening[]            // okna + dveře
  status: 'incomplete' | 'warning' | 'complete'
}

interface Opening {
  type: 'window' | 'door'
  area: number                   // m²
  uValue: number                 // W/m²K
  count: number
}

interface Construction {
  type: ConstructionType
  name: string
  uValue: number                 // W/m²K
}
```

## Průvodce hranou (EdgeWizard)

Po kliknutí na hranu se otevře dvoustupňový panel:

### Krok 1 – Typ konstrukce
Uživatel vybere typ:
- Obvodová stěna
- Střecha plochá
- Střecha šikmá (vytápěný prostor)
- Podlaha na terénu
- Podlaha nad exteriérem
- Vnitřní stěna (mezi zónami nebo nevytápěný prostor)
- Vnitřní strop
- Nevytápěná / nezapočítávaná

Po výběru typu se zobrazí knihovna skladeb s předvyplněnou U-hodnotou.
U-hodnotu lze přepsat ručně.

### Krok 2 – Výplně
Explicitní volba – uživatel MUSÍ zvolit jednu z možností:
- [ Přidat okna / dveře ] → zobrazí se formulář pro zadání počtu, plochy, U-hodnoty
- [ Žádné výplně na této stěně ] → vědomé potvrzení, hrana je kompletní

Bez potvrzení kroku 2 nelze hranu označit jako dokončenou.

## Vizuální stav hran na canvasu

Každá hrana polygonu je barevně odlišena:

| Barva  | Stav | Popis |
|--------|------|-------|
| 🔴 červená | `incomplete` | bez přiřazené konstrukce |
| 🟡 žlutá | `warning` | konstrukce zadána, výplně nepotvrzeny |
| 🟢 zelená | `complete` | konstrukce + výplně (nebo „žádné") potvrzeny |

Export je dostupný pouze pokud jsou VŠECHNY hrany zelené.

## Knihovna skladeb (výchozí obsah MVP)

```typescript
const defaultConstructions = [
  { type: 'exterior_wall',      name: 'Obvodová stěna',              uValue: 0.25 },
  { type: 'roof_flat',          name: 'Střecha plochá',              uValue: 0.16 },
  { type: 'roof_pitched',       name: 'Střecha šikmá (vytáp.)',      uValue: 0.20 },
  { type: 'floor_on_ground',    name: 'Podlaha na terénu',           uValue: 0.45 },
  { type: 'floor_over_ext',     name: 'Podlaha nad exteriérem',      uValue: 0.16 },
  { type: 'interior_wall',      name: 'Vnitřní stěna',               uValue: 2.78 },
  { type: 'interior_ceiling',   name: 'Vnitřní strop',               uValue: 2.93 },
  { type: 'window_default',     name: 'Okno (výchozí)',              uValue: 1.20 },
  { type: 'door_exterior',      name: 'Vnější dveře',                uValue: 2.00 },
]
```

Uživatel může U-hodnotu u každé položky přepsat. Vlastní skladby lze přidat
(uloženy v localStorage).

## Výpočty – definice pojmů

```
Podlahová plocha (AP)
  = součet ploch všech polygonů zón (m²)

Energeticky vztažná plocha (AEP)
  = plocha vytápěných + klimatizovaných zón (m²)
  Zóny s conditionType = HeatedAndCooled nebo HeatedOnly

Objem budovy (V)
  = součet (plocha zóny × výška podlaží) (m³)

Plocha konstrukce (čistá)
  = délka hrany × výška − součet ploch výplní na hraně

Průměrný součinitel prostupu tepla obálky (Uem)
  = součet (U × A) / součet A   [pouze obvodové konstrukce]
```

## Tech stack

- Framework: Vite + React + TypeScript
- Canvas: Konva.js (2D kreslení, polygony, interakce s hranami)
- Styling: Tailwind CSS
- State: Zustand
- Export XML: nativní DOM XML builder (bez externí knihovny)
- Export CSV: nativní Blob + URL.createObjectURL
- Persistence: localStorage (projekty, knihovna skladeb)
- Žádný backend – vše běží v prohlížeči

## Struktura projektu

```
src/
  components/
    canvas/
      ImageCanvas.tsx       # upload obrázku, měřítko, kreslení polygonů
      PolygonLayer.tsx       # vykreslení zón a hran s barevnými stavy
      EdgeHighlight.tsx      # zvýraznění vybrané hrany
    panels/
      EdgeWizard.tsx         # průvodce hranou (2 kroky)
      ZonePanel.tsx          # seznam zón, výška podlaží
      ConstructionLibrary.tsx # knihovna skladeb
    results/
      ResultsSummary.tsx     # výsledná tabulka + metriky
      ExportButton.tsx       # CSV + gbXML export
  store/
    projectStore.ts          # Zustand store – zóny, hrany, měřítko
    libraryStore.ts          # knihovna skladeb
  utils/
    geometry.ts              # výpočty ploch, objemu, měřítka
    gbxmlExport.ts           # generátor gbXML v0.37
    csvExport.ts             # generátor CSV
  types/
    index.ts                 # Edge, Zone, Construction, Opening...
```

## gbXML export – požadavky

- Verze schématu: 0.37
- Jednotky: SI (metry, m², m³, W/m²K)
- Každá zóna = jeden `<Space>` element
- Každá hrana = jedna nebo více `<Surface>` elementů
- Výplně = `<Opening>` vnořené do `<Surface>`
- Povinné atributy: id, surfaceType, constructionIdRef
- Referenční soubor: poupětova_3d_do_dek.xml (struktura v0.37)

## Důležitá pravidla pro vývoj

- Přesnost ploch: 2 desetinná místa
- Export dostupný pouze pokud jsou všechny hrany `complete`
- Nelze smazat zónu pokud má hrany ve stavu `complete` bez potvrzení
- Měřítko musí být nastaveno před kreslením – bez měřítka nelze kreslit
- Kód komentovat anglicky
- Netestovat na produkci – lokální vývoj přes `npm run dev`

## Co NENÍ součástí MVP

- Automatické rozpoznávání geometrie z obrázku (AI/CV)
- 3D model / 3D preview
- Výpočet tepelných ztrát ani potřeby energie
- Import DWG/DXF
- Integrace s Deksoft / Svoboda SW / Energy Hub API
- Uživatelské účty, login, cloudové uložení
