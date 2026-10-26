// What a browser (or the server) tells about an error, and how GMs see them grouped.

export interface ErrorReport {
  source: "client" | "server";
  message: string;
  /** File, line and column where it happened. */
  where: string;
  stack: string;
  /** A short description of the phone or computer. */
  device: string;
  /** Which build of the game. */
  version: string;
  /** What the player was doing: region, screen, connection. */
  context: string;
}

export interface ErrorGroup extends ErrorReport {
  count: number;
  firstAt: number;
  lastAt: number;
  /** A few of the devices it happened on. */
  devices: string[];
}
