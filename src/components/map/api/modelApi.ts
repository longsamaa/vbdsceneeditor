type ObjectProperties = {
    longitude?: number | null;
    latitude?: number | null;
    name?: string | null;
    scale?: number | null;
    bearing?: number | null;
    elevation?: number | null;
    startdate?: string | null;
    enddate?: string | null;
    modeltype?: string | null;
    modelname?: string | null;
    modelurl?: string | null;
    texturename?: string | null;
    textureurl?: string | null;
    coordinates?: unknown;
    height?: number | null;
};

const MODEL_API_URL = import.meta.env.VITE_MODEL_API_URL as string;

export async function saveModelToDb(props: ObjectProperties): Promise<Response> {
    const body = {
        longitude: props.longitude ?? null,
        latitude: props.latitude ?? null,
        name: props.name ?? null,
        scale: props.scale ?? null,
        bearing: props.bearing ?? null,
        elevation: props.elevation ?? null,
        startdate: props.startdate ?? null,
        enddate: props.enddate ?? null,
        modeltype: props.modeltype ?? null,
        modelname: props.modelname ?? null,
        modelurl: props.modelurl ?? null,
        texturename: props.texturename ?? null,
        textureurl: props.textureurl ?? null,
        coordinates: props.coordinates ?? null,
        height: props.height ?? null,
    };
    return fetch(MODEL_API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });
}

export async function deleteModelFromDb(gid: string): Promise<Response> {
    return fetch(`${MODEL_API_URL}/${gid}`, {
        method: 'DELETE',
    });
}
