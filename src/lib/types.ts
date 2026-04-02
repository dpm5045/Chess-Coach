// Chess.com API types

export interface ChessComPlayer {
  player_id: number;
  username: string;
  url: string;
  avatar?: string;
  name?: string;
  title?: string;
  country: string;
  last_online: number;
  joined: number;
  status: string;
  league?: string;
  followers?: number;
  is_streamer?: boolean;
}

export interface RatingRecord {
  last?: { rating: number; date: number; rd: number };
  best?: { rating: number; date: number; rd?: number };
  wins: number;
  losses: number;
  draws: number;
  games: number;
}

export interface ChessComStats {
  chess_rapid?: RatingRecord;
  chess_blitz?: RatingRecord;
  chess_bullet?: RatingRecord;
  chess_daily?: RatingRecord;
}

export type GameResult =
  | "win"
  | "resigned"
  | "checkmated"
  | "timeout"
  | "stalemate"
  | "insufficient"
  | "repetition"
  | "agreed"
  | "abandoned"
  | "timevsinsufficient"
  | "50move"
  | (string & {});

export interface PlayerResult {
  username: string;
  rating: number;
  result: GameResult;
  "@id": string;
  uuid: string;
}

export interface ChessComGame {
  url: string;
  pgn: string;
  uuid: string;
  time_class: TimeClass;
  time_control: string;
  rated: boolean;
  rules: string;
  white: PlayerResult;
  black: PlayerResult;
  end_time: number;
  initial_setup?: string;
  fen?: string;
}

export type TimeClass = "bullet" | "blitz" | "rapid" | "daily";

export interface PlayerProfile {
  profile: ChessComPlayer;
  stats: ChessComStats;
}

// Analysis types

export interface AnalysisResult {
  opening: {
    name: string;
    assessment: "good" | "inaccurate" | "dubious";
    comment: string;
  };
  criticalMoments: CriticalMoment[];
  positionalThemes: string;
  endgame: {
    reached: boolean;
    comment: string;
  };
  summary: {
    overallAssessment: string;
    focusArea: string;
  };
}

export interface CriticalMoment {
  moveNumber: number;
  move: string;
  type: "blunder" | "mistake" | "excellent" | "missed_tactic";
  comment: string;
  suggestion?: string;
}
