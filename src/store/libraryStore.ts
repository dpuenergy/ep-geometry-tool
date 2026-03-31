// Zustand store for the construction library (typy konstrukcí)
// Persists to localStorage

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Construction, ConstructionType } from '../types'

export const defaultConstructions: Construction[] = [
  { type: 'exterior_wall',    name: 'Obvodová stěna',          thicknessMeters: 0.30 },
  { type: 'roof_flat',        name: 'Střecha plochá',          thicknessMeters: 0.25 },
  { type: 'roof_pitched',     name: 'Střecha šikmá (vytáp.)',  thicknessMeters: 0.20 },
  { type: 'floor_on_ground',  name: 'Podlaha na terénu',       thicknessMeters: 0.20 },
  { type: 'floor_over_ext',   name: 'Podlaha nad exteriérem',  thicknessMeters: 0.25 },
  { type: 'interior_wall',    name: 'Vnitřní stěna',           thicknessMeters: 0.15 },
  { type: 'interior_ceiling', name: 'Vnitřní strop',           thicknessMeters: 0.20 },
  { type: 'window_default',   name: 'Okno (výchozí)',          thicknessMeters: 0    },
  { type: 'door_exterior',    name: 'Vnější dveře',            thicknessMeters: 0    },
  { type: 'unheated',         name: 'Nezapočítávaná',          thicknessMeters: 0    },
]

interface LibraryState {
  constructions: Construction[]
  updateName: (type: ConstructionType, name: string) => void
  updateThickness: (type: ConstructionType, thicknessMeters: number) => void
  addConstruction: (c: Construction) => void
  removeConstruction: (type: ConstructionType) => void
  reset: () => void
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      constructions: defaultConstructions,

      updateName: (type, name) =>
        set((state) => ({
          constructions: state.constructions.map((c) =>
            c.type === type ? { ...c, name } : c
          ),
        })),

      updateThickness: (type, thicknessMeters) =>
        set((state) => ({
          constructions: state.constructions.map((c) =>
            c.type === type ? { ...c, thicknessMeters } : c
          ),
        })),

      addConstruction: (c) =>
        set((state) => ({ constructions: [...state.constructions, c] })),

      removeConstruction: (type) =>
        set((state) => ({
          constructions: state.constructions.filter((c) => c.type !== type),
        })),

      reset: () => set({ constructions: defaultConstructions }),
    }),
    { name: 'ep-library' }
  )
)
