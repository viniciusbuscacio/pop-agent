export interface RestGateway {
    call(input: {
        url: string;
        method: string;
        body?: string;
        credential?: {
            name: string;
            value: string;
        };
        signal?: AbortSignal;
    }): Promise<{
        status: number;
        body: string;
    }>;
}
