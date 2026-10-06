import type { GameState } from '../game/ram.js';

/**
 * Story knowledge: WHAT the next goal is and WHERE it happens. Nothing about which buttons to press.
 * Completion is checked against the game's own event flags, badges and items, never assumed.
 * Jev still makes every decision: where to walk, who to talk to, what to answer, how to fight.
 */
export interface Milestone {
  id: string;
  /** short title for the overlay ("Defeat Brock") */
  title: string;
  /** where, for the overlay ("Pewter Gym · Rock/Ground") */
  place: string;
  /** plain-language objective shown to Jev */
  goal: string;
  /** map(s) where the objective happens: exits are annotated with their distance to these */
  maps: string[];
  done: (g: GameState, visited: Set<string>) => boolean;
  /** typical level of the toughest opponent here (guide knowledge, for "is the team ready" facts) */
  level?: number;
  /** types of the objective's main opponents (for team matchup facts) */
  types?: string[];
}

const ev = (name: string) => (g: GameState) => g.event(name);
const badge = (bit: number) => (g: GameState) => !!(g.badges & (1 << bit));
const reached = (map: string, laterBadges: number) => (g: GameState, v: Set<string>) => v.has(map) || g.badgeCount > laterBadges;
const has = (item: string) => (g: GameState) => g.bag().some((i) => i.name === item);

export const MILESTONES: Milestone[] = [
  { id: 'meet_oak', title: 'Meet Professor Oak', place: 'Pallet Town · Route 1', goal: 'Leave the house and walk north out of Pallet Town toward Route 1. Professor Oak will stop you and take you to his lab.', maps: ['ROUTE_1'], done: ev('EVENT_FOLLOWED_OAK_INTO_LAB') },
  { id: 'starter', title: 'Choose a starter', place: "Oak's Lab", goal: "In Oak's lab, choose a starter Pokémon from the Poké Balls on the table.", maps: ['OAKS_LAB'], done: ev('EVENT_GOT_STARTER') },
  { id: 'rival_1', title: 'First rival battle', place: "Oak's Lab", goal: "Battle your rival in Oak's lab. He challenges you when you try to leave.", maps: ['OAKS_LAB'], done: ev('EVENT_BATTLED_RIVAL_IN_OAKS_LAB'), level: 5 },
  { id: 'parcel', title: "Pick up Oak's Parcel", place: 'Viridian City · Poké Mart', goal: "Go north along Route 1 to Viridian City and enter the Poké Mart to pick up Oak's Parcel.", maps: ['VIRIDIAN_MART'], done: ev('EVENT_GOT_OAKS_PARCEL'), level: 4 },
  { id: 'pokedex', title: 'Deliver the parcel', place: "Oak's Lab", goal: "Bring Oak's Parcel back to Professor Oak in his lab in Pallet Town and talk to him.", maps: ['OAKS_LAB'], done: ev('EVENT_GOT_POKEDEX') },
  { id: 'pewter', title: 'Reach Pewter City', place: 'Route 2 · Viridian Forest', goal: 'Head north from Viridian City through Route 2 and Viridian Forest to Pewter City.', maps: ['PEWTER_CITY'], done: reached('PEWTER_CITY', 0), level: 9 },
  { id: 'brock', title: 'Defeat Brock', place: 'Pewter Gym · Rock/Ground', goal: 'Defeat Brock, the Pewter City Gym Leader. His Pokémon are Rock/Ground type: Water, Grass and Fighting moves are strong against them; Normal, Fire and Flying moves are weak.', maps: ['PEWTER_GYM'], done: badge(0), level: 14, types: ['ROCK', 'GROUND'] },
  { id: 'cerulean', title: 'Reach Cerulean City', place: 'Route 3 · Mt. Moon', goal: 'Travel east from Pewter City along Route 3, through Mt. Moon, and along Route 4 to Cerulean City.', maps: ['CERULEAN_CITY'], done: reached('CERULEAN_CITY', 1), level: 14 },
  { id: 'misty', title: 'Defeat Misty', place: 'Cerulean Gym · Water', goal: 'Defeat Misty, the Cerulean City Gym Leader. Her Pokémon are Water type (Starmie is also Psychic): Electric and Grass moves are strong; Fire moves are weak.', maps: ['CERULEAN_GYM'], done: badge(1), level: 21, types: ['WATER'] },
  { id: 'bill', title: 'Visit Bill', place: 'Nugget Bridge · Route 25', goal: "Go north from Cerulean across Nugget Bridge (Route 24) and east along Route 25 to Bill's house. Help Bill and receive the S.S. Ticket.", maps: ['BILLS_HOUSE'], done: ev('EVENT_GOT_SS_TICKET'), level: 20 },
  { id: 'ss_anne', title: 'Get HM01 Cut', place: 'Vermilion · S.S. Anne', goal: "Go south from Cerulean through Route 5, the Underground Path and Route 6 to Vermilion City. Board the S.S. Anne at the dock and get HM01 (Cut) from the captain.", maps: ['SS_ANNE_CAPTAINS_ROOM'], done: ev('EVENT_GOT_HM01'), level: 22 },
  { id: 'surge', title: 'Defeat Lt. Surge', place: 'Vermilion Gym · Electric', goal: 'Defeat Lt. Surge at the Vermilion City Gym. A small tree blocks the entrance (Cut clears it). His Pokémon are Electric type: Ground moves are strong; Water and Flying moves are weak.', maps: ['VERMILION_GYM'], done: badge(2), level: 24, types: ['ELECTRIC'] },
  { id: 'lavender', title: 'Reach Lavender Town', place: 'Route 9 · Rock Tunnel', goal: 'Go back to Cerulean, east along Route 9 to Rock Tunnel on Route 10, and through it south to Lavender Town.', maps: ['LAVENDER_TOWN'], done: reached('LAVENDER_TOWN', 3), level: 26 },
  { id: 'celadon', title: 'Reach Celadon City', place: 'Route 8 · Underground Path', goal: 'Go west from Lavender Town along Route 8 and through the Underground Path to Celadon City.', maps: ['CELADON_CITY'], done: reached('CELADON_CITY', 3), level: 28 },
  { id: 'erika', title: 'Defeat Erika', place: 'Celadon Gym · Grass', goal: 'Defeat Erika at the Celadon City Gym. Her Pokémon are Grass type: Fire, Ice, Flying and Bug moves are strong; Water and Ground moves are weak.', maps: ['CELADON_GYM'], done: badge(3), level: 29, types: ['GRASS'] },
  { id: 'rocket_hideout', title: 'Raid the Rocket Hideout', place: 'Celadon Game Corner', goal: 'Find the Team Rocket Hideout under the Celadon Game Corner (a poster hides the switch), get the Lift Key, and defeat Giovanni to get the Silph Scope.', maps: ['ROCKET_HIDEOUT_B4F'], done: (g) => g.event('EVENT_BEAT_ROCKET_HIDEOUT_GIOVANNI') && has('SILPH SCOPE')(g), level: 30 },
  { id: 'pokemon_tower', title: 'Rescue Mr. Fuji', place: 'Pokémon Tower · Ghost', goal: 'In Lavender Town, climb Pokémon Tower with the Silph Scope, calm the Marowak ghost and rescue Mr. Fuji at the top.', maps: ['POKEMON_TOWER_7F'], done: ev('EVENT_RESCUED_MR_FUJI'), level: 32, types: ['GHOST', 'POISON'] },
  { id: 'poke_flute', title: 'Get the Poké Flute', place: 'Lavender Town', goal: "Talk to Mr. Fuji in his house in Lavender Town to receive the Poké Flute.", maps: ['MR_FUJIS_HOUSE'], done: (g) => g.event('EVENT_GOT_POKE_FLUTE') || has('POKé FLUTE')(g), level: 32 },
  { id: 'fuchsia', title: 'Reach Fuchsia City', place: 'Routes 12–15 · Cycling Road', goal: 'Travel to Fuchsia City: south along Routes 12-15 (wake the sleeping Snorlax with the Poké Flute), or along Cycling Road (Routes 16-18) with a bicycle.', maps: ['FUCHSIA_CITY'], done: reached('FUCHSIA_CITY', 4), level: 34 },
  { id: 'koga', title: 'Defeat Koga', place: 'Fuchsia Gym · Poison', goal: 'Defeat Koga at the Fuchsia City Gym. His Pokémon are Poison type: Psychic and Ground moves are strong; Grass and Bug moves are weak.', maps: ['FUCHSIA_GYM'], done: badge(4), level: 43, types: ['POISON'] },
  { id: 'surf', title: 'Get HM03 Surf', place: 'Safari Zone', goal: 'In the Safari Zone north of Fuchsia City, reach the Secret House to get HM03 (Surf). Also find the Gold Teeth there.', maps: ['SAFARI_ZONE_SECRET_HOUSE'], done: ev('EVENT_GOT_HM03'), level: 36 },
  { id: 'strength', title: 'Get HM04 Strength', place: "Warden's House", goal: "Give the Gold Teeth to the Safari Zone Warden in his house in Fuchsia City to get HM04 (Strength).", maps: ['WARDENS_HOUSE'], done: ev('EVENT_GOT_HM04'), level: 36 },
  { id: 'silph', title: 'Free Silph Co.', place: 'Saffron City', goal: 'Enter Silph Co. in Saffron City (give the gate guard a drink from the Celadon Dept. Store roof to get into Saffron), find the Card Key, and defeat Giovanni on the top floors.', maps: ['SILPH_CO_11F'], done: ev('EVENT_BEAT_SILPH_CO_GIOVANNI'), level: 41 },
  { id: 'sabrina', title: 'Defeat Sabrina', place: 'Saffron Gym · Psychic', goal: 'Defeat Sabrina at the Saffron City Gym (teleport pads connect its rooms). Her Pokémon are Psychic type: Bug moves are strong; Fighting and Poison moves are weak.', maps: ['SAFFRON_GYM'], done: badge(5), level: 43, types: ['PSYCHIC'] },
  { id: 'secret_key', title: 'Find the Secret Key', place: 'Cinnabar · Pokémon Mansion', goal: 'Surf south from Pallet Town along Route 21 to Cinnabar Island. Explore the Pokémon Mansion to find the Secret Key.', maps: ['POKEMON_MANSION_B1F'], done: (g) => has('SECRET KEY')(g) || g.badgeCount > 6, level: 40 },
  { id: 'blaine', title: 'Defeat Blaine', place: 'Cinnabar Gym · Fire', goal: 'Defeat Blaine at the Cinnabar Island Gym. His Pokémon are Fire type: Water, Ground and Rock moves are strong; Grass and Bug moves are weak.', maps: ['CINNABAR_GYM'], done: badge(6), level: 47, types: ['FIRE'] },
  { id: 'giovanni', title: 'Defeat Giovanni', place: 'Viridian Gym · Ground', goal: 'Defeat Giovanni at the Viridian City Gym. His Pokémon are Ground type: Water, Grass and Ice moves are strong; Electric moves have no effect.', maps: ['VIRIDIAN_GYM'], done: badge(7), level: 50, types: ['GROUND'] },
  { id: 'victory_road', title: 'Cross Victory Road', place: 'Route 23 · Victory Road', goal: 'Go west from Viridian City along Route 22, north along Route 23 through the badge gates, and through Victory Road (push boulders onto switches with Strength) to the Indigo Plateau.', maps: ['INDIGO_PLATEAU_LOBBY'], done: (g, v) => v.has('INDIGO_PLATEAU_LOBBY') || g.event('EVENT_BEAT_LORELEIS_ROOM_TRAINER_0'), level: 48 },
  { id: 'lorelei', title: 'Defeat Lorelei', place: 'Elite Four · Ice', goal: 'Elite Four: defeat Lorelei (Ice/Water). The Elite Four battles are back to back with no Pokémon Center in between: healing is only possible with items.', maps: ['LORELEIS_ROOM'], done: ev('EVENT_BEAT_LORELEIS_ROOM_TRAINER_0'), level: 56, types: ['ICE', 'WATER'] },
  { id: 'bruno', title: 'Defeat Bruno', place: 'Elite Four · Fighting', goal: 'Elite Four: defeat Bruno (Fighting/Rock). Healing is only possible with items.', maps: ['BRUNOS_ROOM'], done: ev('EVENT_BEAT_BRUNOS_ROOM_TRAINER_0'), level: 58, types: ['FIGHTING', 'ROCK'] },
  { id: 'agatha', title: 'Defeat Agatha', place: 'Elite Four · Ghost', goal: 'Elite Four: defeat Agatha (Ghost/Poison). Healing is only possible with items.', maps: ['AGATHAS_ROOM'], done: ev('EVENT_BEAT_AGATHAS_ROOM_TRAINER_0'), level: 60, types: ['GHOST', 'POISON'] },
  { id: 'lance', title: 'Defeat Lance', place: 'Elite Four · Dragon', goal: 'Elite Four: defeat Lance (Dragon/Flying). Healing is only possible with items.', maps: ['LANCES_ROOM'], done: ev('EVENT_BEAT_LANCE'), level: 62, types: ['DRAGON', 'FLYING'] },
  { id: 'champion', title: 'Become Champion', place: 'Indigo Plateau', goal: 'Defeat your rival, the Champion, and enter the Hall of Fame.', maps: ['CHAMPIONS_ROOM'], done: ev('EVENT_BEAT_CHAMPION_RIVAL'), level: 65 },
];

export function currentMilestone(g: GameState, visited: Set<string>): { index: number; m: Milestone | null } {
  for (let i = 0; i < MILESTONES.length; i++) if (!MILESTONES[i].done(g, visited)) return { index: i, m: MILESTONES[i] };
  return { index: MILESTONES.length, m: null };
}

/** Gym badges in order (bit n of wObtainedBadges), with who awards them and where. */
export const BADGES = [
  { name: 'Boulder Badge', leader: 'Brock', where: 'Pewter Gym' },
  { name: 'Cascade Badge', leader: 'Misty', where: 'Cerulean Gym' },
  { name: 'Thunder Badge', leader: 'Lt. Surge', where: 'Vermilion Gym' },
  { name: 'Rainbow Badge', leader: 'Erika', where: 'Celadon Gym' },
  { name: 'Soul Badge', leader: 'Koga', where: 'Fuchsia Gym' },
  { name: 'Marsh Badge', leader: 'Sabrina', where: 'Saffron Gym' },
  { name: 'Volcano Badge', leader: 'Blaine', where: 'Cinnabar Gym' },
  { name: 'Earth Badge', leader: 'Giovanni', where: 'Viridian Gym' },
];
