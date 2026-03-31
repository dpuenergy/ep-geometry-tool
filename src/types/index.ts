// Core domain types for EP Geometry Tool

export interface Point {
  x: number
  y: number
}

export type ConstructionType =
  | 'exterior_wall'
  | 'roof_flat'
  | 'roof_pitched'
  | 'floor_on_ground'
  | 'floor_over_ext'
  | 'interior_wall'
  | 'interior_ceiling'
  | 'window_default'
  | 'door_exterior'
  | 'unheated'

export interface Construction {
  type: ConstructionType
  name: string
  /** Wall thickness in meters – used to correct floor area from polygon to interior face */
  thicknessMeters: number
}

export interface Opening {
  id: string
  type: 'window' | 'door'
  area: number
  count: number
}

export type EdgeStatus = 'incomplete' | 'warning' | 'complete'

export interface Edge {
  id: string
  points: [Point, Point]
  lengthMeters: number
  construction: Construction | null
  openings: Opening[]
  openingsConfirmed: boolean
  status: EdgeStatus
  linkedEdgeId: string | null   // cross-drawing pairing
}

export type ConditionType = 'HeatedOnly' | 'HeatedAndCooled' | 'Unheated' | 'Unconditioned'

export type DrawingViewType = 'plan' | 'elevation' | 'section'

export const DRAWING_VIEW_LABELS: Record<DrawingViewType, string> = {
  plan:      'Půdorys',
  elevation: 'Pohled',
  section:   'Řez',
}

export const VIEW_CONSTRUCTION_PRIORITY: Record<DrawingViewType, ConstructionType[]> = {
  plan: [
    'exterior_wall', 'interior_wall',
    'floor_on_ground', 'floor_over_ext', 'interior_ceiling',
    'roof_flat', 'roof_pitched',
    'window_default', 'door_exterior', 'unheated',
  ],
  elevation: [
    'exterior_wall', 'window_default', 'door_exterior',
    'roof_flat', 'roof_pitched',
    'interior_wall', 'floor_on_ground', 'floor_over_ext',
    'interior_ceiling', 'unheated',
  ],
  section: [
    'exterior_wall', 'roof_flat', 'roof_pitched',
    'floor_on_ground', 'floor_over_ext', 'interior_ceiling',
    'interior_wall', 'window_default', 'door_exterior', 'unheated',
  ],
}

export interface Scale {
  pointA: Point
  pointB: Point
  realDistanceMeters: number
  pixelsPerMeter: number
}

/** Global zone category defined at project level (e.g. Vytápěná, Nevytápěná). */
export interface ZoneType {
  id: string
  name: string
  conditionType: ConditionType
  color: string
}

/** One canvas with its own background image, scale, view type and floor height. */
export interface Drawing {
  id: string
  name: string
  viewType: DrawingViewType
  backgroundImage: string | null
  backgroundRotation: number
  scale: Scale | null
  floorHeightMeters: number
}

/**
 * Zone: closed polygon drawn in a PLAN drawing.
 * Belongs to a global ZoneType. The same ZoneType can appear on multiple floors.
 */
export interface Zone {
  id: string
  drawingId: string
  zoneTypeId: string
  name: string
  points: Point[]
  areaM2: number
  edgeIds: string[]
  floorConstruction: Construction | null
  ceilingConstruction: Construction | null
}

/**
 * Surface: closed polygon drawn in an ELEVATION or SECTION drawing.
 * Edges carry construction type and openings.
 */
export interface Surface {
  id: string
  drawingId: string
  name: string
  points: Point[]
  edgeIds: string[]
  linkedPlanEdgeId: string | null
  construction: Construction | null
}

export const FLOOR_CONSTRUCTION_PRIORITY: ConstructionType[] = [
  'floor_on_ground', 'floor_over_ext', 'interior_ceiling', 'unheated',
  'exterior_wall', 'interior_wall', 'roof_flat', 'roof_pitched', 'window_default', 'door_exterior',
]

export const CEILING_CONSTRUCTION_PRIORITY: ConstructionType[] = [
  'roof_flat', 'roof_pitched', 'interior_ceiling', 'unheated',
  'floor_on_ground', 'floor_over_ext', 'exterior_wall', 'interior_wall', 'window_default', 'door_exterior',
]

export const SURFACE_CONSTRUCTION_PRIORITY: ConstructionType[] = [
  'exterior_wall', 'window_default', 'door_exterior',
  'roof_flat', 'roof_pitched', 'interior_wall',
  'floor_on_ground', 'floor_over_ext', 'interior_ceiling', 'unheated',
]

export const BUILDING_TYPES: Record<string, string> = {
  Office:          'Kanceláře',
  MultiFamily:     'Bytový dům',
  SingleFamily:    'Rodinný dům',
  School:          'Škola',
  University:      'Univerzita',
  Hospital:        'Nemocnice / zdravotnictví',
  Retail:          'Obchod',
  Warehouse:       'Sklad / výroba',
  SportsFacility:  'Sportovní zařízení',
  Hotel:           'Hotel',
  Library:         'Knihovna',
  Religious:       'Sakrální stavba',
  Transportation:  'Dopravní stavba',
  Parking:         'Garážový dům',
  Unconditioned:   'Nekondicionovaná budova',
}

export interface Project {
  id: string
  name: string
  buildingType: string    // gbXML buildingType attribute
  location: string        // free-text city / address
  activeDrawingId: string
  drawings: Drawing[]
  zoneTypes: ZoneType[]
  zones: Zone[]
  surfaces: Surface[]
  edges: Record<string, Edge>
}

export interface ProjectMetrics {
  floorAreaM2: number
  energyRelatedAreaM2: number
  volumeM3: number
  allEdgesComplete: boolean
}
