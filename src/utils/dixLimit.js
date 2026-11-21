export const DAILY_LIMIT_MESSAGE =
`*⌬ LÍMITE DIARIO ALCANZADO ✰*

➔ Se alcanzó el límite diario de solicitudes para esta apikey.

*♛ Propietario o desarrollador de esta instancia:*
Actualiza el límite desde el panel web:
https://dix.lat/p#tienda

*웃 Usuario:*
* ✎ Esta acción solo puede realizarla el dueño de la instancia. Avisa al administrador del bot o intenta de nuevo más tarde, ya que el límite se restablece automáticamente.`;

export class DixLimitError extends Error {
    constructor() {
        super('DIX_DAILY_LIMIT');
        this.name = 'DixLimitError';
    }
}

export const isDailyLimit = (data) => Boolean(data) && data.success === false && Number(data.code) === 429;

export const isLimitError = (error) => error instanceof DixLimitError || isDailyLimit(error?.response?.data);

export const assertNoLimit = (data) => {
    if (isDailyLimit(data)) throw new DixLimitError();
    return data;
};
