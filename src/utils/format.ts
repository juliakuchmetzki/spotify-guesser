export const formatDuration = (seconds: number) => `${seconds.toLocaleString('de-DE')} s`;

/** Ausgeschrieben für Fließtext: "0,5 Sekunden", "1 Sekunde" */
export const formatSeconds = (seconds: number) =>
  `${seconds.toLocaleString('de-DE')} ${seconds === 1 ? 'Sekunde' : 'Sekunden'}`;
