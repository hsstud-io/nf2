import { XMLParser } from 'fast-xml-parser';
import { pool } from '../db.js';
import {
    consultarSefaz,
    manifestarSefaz,
} from './sefaz.js';
import { gerarDanfe } from './danfe.js';
import { saveFile } from './files.js';

interface ParsedDocInfo {
    emitCnpj: string | null;
    destCnpj: string | null;
    chave: string | null;
    valor: string | null;
    dataEmissao: string | null;
}

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: () => false,
});

function findEl(
    obj: any,
    name: string,
): any {
    if (
        !obj ||
        typeof obj !== 'object'
    ) {
        return null;
    }

    for (const key of Object.keys(obj)) {
        if (key === name) {
            return obj[key];
        }

        const nested = findEl(
            obj[key],
            name,
        );

        if (nested !== null) {
            return nested;
        }
    }

    return null;
}

function extractCnpjFromXml(
    xml: string,
): ParsedDocInfo {
    const parsed =
        xmlParser.parse(xml);

    const infNFe =
        findEl(parsed, 'infNFe');

    const chave =
        infNFe?.['@_Id']
            ?.replace('NFe', '') ||
        null;

    const emit =
        findEl(parsed, 'emit');

    const dest =
        findEl(parsed, 'dest');

    const emitCnpj =
        findEl(emit, 'CNPJ') ||
        null;

    const destCnpj =
        findEl(dest, 'CNPJ') ||
        null;

    const valor =
        findEl(parsed, 'vNF') ||
        null;

    const dhEmi =
        findEl(parsed, 'dhEmi') ||
        findEl(parsed, 'dEmi') ||
        null;

    let dataEmissao:
        string | null = null;

    if (dhEmi) {
        dataEmissao =
            String(dhEmi).substring(
                0,
                10,
            );
    }

    return {
        emitCnpj,
        destCnpj,
        chave,
        valor:
            valor !== null
                ? String(valor)
                : null,
        dataEmissao,
    };
}

function parseResNFe(
    xml: string,
): ParsedDocInfo {
    const parsed =
        xmlParser.parse(xml);

    const chNFe =
        findEl(parsed, 'chNFe') ||
        null;

    const emit =
        findEl(parsed, 'emit');

    const dest =
        findEl(parsed, 'dest');

    const emitCnpj =
        findEl(emit, 'CNPJ') ||
        findEl(parsed, 'CNPJ') ||
        null;

    const destCnpj =
        findEl(dest, 'CNPJ') ||
        null;

    const valor =
        findEl(parsed, 'vNF') ||
        null;

    const dhEmi =
        findEl(parsed, 'dhEmi') ||
        findEl(parsed, 'dhRecbto') ||
        null;

    let dataEmissao:
        string | null = null;

    if (dhEmi) {
        dataEmissao =
            String(dhEmi).substring(
                0,
                10,
            );
    }

    return {
        emitCnpj,
        destCnpj,
        chave:
            chNFe !== null
                ? String(chNFe)
                : null,
        valor:
            valor !== null
                ? String(valor)
                : null,
        dataEmissao,
    };
}

function converterValor(
    valor: string | null,
): number | null {
    if (
        valor === null ||
        valor === undefined ||
        String(valor).trim() === ''
    ) {
        return null;
    }

    const texto =
        String(valor).trim();

    /*
     * XML fiscal normalmente utiliza ponto decimal.
     * O tratamento adicional suporta também valor
     * formatado no padrão brasileiro.
     */
    const textoNormalizado =
        texto.includes(',') &&
            texto.includes('.')
            ? texto
                .replace(/\./g, '')
                .replace(',', '.')
            : texto.replace(',', '.');

    const valorNumerico =
        Number(textoNormalizado);

    return Number.isFinite(
        valorNumerico,
    )
        ? valorNumerico
        : null;
}

function obterDataReferencia(
    dataEmissao: string | null,
): Date {
    if (!dataEmissao) {
        return new Date();
    }

    const data =
        new Date(
            `${dataEmissao}T12:00:00`,
        );

    if (
        Number.isNaN(
            data.getTime(),
        )
    ) {
        return new Date();
    }

    return data;
}

export async function sincronizar(
    ambiente: string,
): Promise<{
    success: boolean;
    documentosEncontrados: number;
    notasManifestadas: number;
    xmlsBaixados: number;
    danfesGerados: number;
    ultNSU: number;
    maxNSU: number;
    mensagem: string;
}> {
    const now =
        new Date();

    /*
     * As variáveis ficam fora do try para que o catch
     * consiga preservar o último estado conhecido.
     */
    let ultNSU = 0;
    let maxNSU = 0;
    let documentosEncontrados = 0;
    let notasManifestadas = 0;
    let xmlsBaixados = 0;
    let danfesGerados = 0;

    /*
     * Tenta iniciar a sincronização de forma atômica.
     *
     * O UPDATE somente será executado quando:
     *
     * 1. Não existir outra sincronização recente em andamento.
     * 2. A última consulta sem documentos tiver ocorrido
     *    há pelo menos uma hora.
     *
     * O bloqueio no PostgreSQL protege também contra:
     * - duplo clique;
     * - duas abas;
     * - chamada direta da API;
     * - cron e execução manual ao mesmo tempo.
     */
    const { rows: inicioRows } =
    await pool.query(
        `UPDATE sync_control
            SET status_ultima_execucao = 'em_andamento',
                ultima_execucao = $1,
                mensagem = NULL
          WHERE id = 1

            /*
             * Permite iniciar quando:
             *
             * - o status está NULL;
             * - o status não é "em_andamento";
             * - não existe data de execução;
             * - ou a execução anterior está em andamento
             *   há pelo menos 30 minutos.
             *
             * O operador IS DISTINCT FROM trata NULL
             * corretamente e funciona com colunas enum.
             */
            AND (
                status_ultima_execucao
                    IS DISTINCT FROM 'em_andamento'

                OR ultima_execucao IS NULL

                OR ultima_execucao <=
                    NOW() - INTERVAL '30 minutes'
            )

            /*
             * Permite iniciar quando:
             *
             * - a mensagem está NULL;
             * - a última mensagem não informa ausência
             *   de documentos;
             * - não existe data da última execução;
             * - ou já passou pelo menos uma hora.
             */
            AND (
                mensagem IS NULL

                OR mensagem NOT ILIKE
                    '%Nenhum documento localizado%'

                OR ultima_execucao IS NULL

                OR ultima_execucao <=
                    NOW() - INTERVAL '1 hour'
            )

          RETURNING *`,
        [
            now.toISOString(),
        ],
    );

    /*
     * Nenhuma linha atualizada significa que a execução
     * foi bloqueada por uma das condições acima.
     */
    if (inicioRows.length === 0) {
        const { rows: controleRows } =
            await pool.query(
                `SELECT
                 status_ultima_execucao,
                 ultima_execucao,
                 mensagem
               FROM sync_control
              WHERE id = 1`,
            );

        const controleAtual =
            controleRows[0];

        if (!controleAtual) {
            throw new Error(
                'O registro de controle da sincronização não foi encontrado.',
            );
        }

        const statusAtual =
            String(
                controleAtual.status_ultima_execucao ?? '',
            );

        const mensagemAtual =
            String(
                controleAtual.mensagem ?? '',
            );

        const ultimaExecucao =
            controleAtual.ultima_execucao
                ? new Date(
                    controleAtual.ultima_execucao,
                )
                : null;

        /*
         * Outra sincronização ainda está rodando.
         */
        if (
            statusAtual === 'em_andamento' &&
            ultimaExecucao &&
            !Number.isNaN(
                ultimaExecucao.getTime(),
            )
        ) {
            const minutosEmExecucao =
                Math.max(
                    1,
                    Math.floor(
                        (
                            now.getTime() -
                            ultimaExecucao.getTime()
                        ) /
                        60000,
                    ),
                );

            throw new Error(
                `Já existe uma sincronização em andamento há aproximadamente ${minutosEmExecucao} minuto(s).`,
            );
        }

        /*
         * A última consulta não encontrou documentos
         * e ainda não passou uma hora.
         */
        if (
            mensagemAtual.includes(
                'Nenhum documento localizado',
            ) &&
            ultimaExecucao &&
            !Number.isNaN(
                ultimaExecucao.getTime(),
            )
        ) {
            const proximaConsultaPermitida =
                new Date(
                    ultimaExecucao.getTime() +
                    60 * 60 * 1000,
                );

            const minutosRestantes =
                Math.max(
                    1,
                    Math.ceil(
                        (
                            proximaConsultaPermitida.getTime() -
                            now.getTime()
                        ) /
                        60000,
                    ),
                );

            throw new Error(
                `A última consulta não encontrou documentos. Aguarde aproximadamente ${minutosRestantes} minuto(s) antes de sincronizar novamente.`,
            );
        }

        throw new Error(
            `A sincronização não pôde ser iniciada neste momento. ` +
            `Status atual=${statusAtual || 'não informado'}, ` +
            `última execução=${
                ultimaExecucao
                    ? ultimaExecucao.toISOString()
                    : 'não informada'
            }, ` +
            `mensagem=${mensagemAtual || 'não informada'}.`,
        );
    }

    /*
     * O UPDATE RETURNING já devolve o estado atual do controle,
     * incluindo ult_nsu e max_nsu.
     */
    const sync =
        inicioRows[0];

    try {

        ultNSU =
            Number(
                sync?.ult_nsu ?? 0,
            );

        maxNSU =
            Number(
                sync?.max_nsu ?? 0,
            );

        if (
            Number.isNaN(ultNSU) ||
            Number.isNaN(maxNSU)
        ) {
            throw new Error(
                `Os NSUs armazenados são inválidos. ultNSU=${sync?.ult_nsu}, maxNSU=${sync?.max_nsu}.`,
            );
        }

        const todasMensagens:
            string[] = [];

        /*
         * Carrega as unidades ativas e cria um mapa
         * usando o CNPJ normalizado.
         */
        const { rows: unidades } =
            await pool.query(
                `SELECT *
           FROM unidades
          WHERE ativo = true
          ORDER BY id`,
            );

        if (unidades.length === 0) {
            throw new Error(
                'Nenhuma unidade ativa foi cadastrada.',
            );
        }

        /*
         * A estrutura atual possui somente um registro em sync_control.
         * Por isso, neste momento, o sistema suporta apenas uma unidade
         * ativa por controle de NSU.
         *
         * Quando houver várias unidades, será necessário manter
         * ultNSU e maxNSU individualmente para cada unidade.
         */
        if (unidades.length > 1) {
            throw new Error(
                `Existem ${unidades.length} unidades ativas. O controle de NSU precisa ser separado por unidade antes de sincronizar múltiplos CNPJs.`,
            );
        }

        const unidadeConsulta =
            unidades[0];

        const cnpjUnidadeConsulta =
            String(
                unidadeConsulta.cnpj ?? '',
            ).replace(/\D/g, '');

        if (
            !/^\d{14}$/.test(
                cnpjUnidadeConsulta,
            )
        ) {
            throw new Error(
                `O CNPJ da unidade é inválido: ${unidadeConsulta.cnpj}.`,
            );
        }

        const unidadeByCnpj =
            new Map < string, any> ();

        for (
            const unidade of unidades
        ) {
            const cnpjNormalizado =
                String(
                    unidade.cnpj ?? '',
                ).replace(/\D/g, '');

            if (
                cnpjNormalizado.length === 14
            ) {
                unidadeByCnpj.set(
                    cnpjNormalizado,
                    unidade,
                );
            }
        }

        console.log(
            '[SYNC] Unidade selecionada para consulta:',
            {
                unidadeId:
                    unidadeConsulta.id,

                nome:
                    unidadeConsulta.nome,

                cnpjMascarado:
                    `${cnpjUnidadeConsulta.substring(0, 8)}****${cnpjUnidadeConsulta.substring(12)}`,

                cnpjRaiz:
                    cnpjUnidadeConsulta.substring(
                        0,
                        8,
                    ),

                ultNSUInicial:
                    ultNSU,
            },
        );

        let keepGoing = true;


        while (keepGoing) {
            const consultaResult =
                await consultarSefaz(
                    ultNSU.toString(),
                    ambiente,
                    cnpjUnidadeConsulta,
                );

            /*
             * CNPJ utilizado na consulta à SEFAZ.
             * Serve como fallback para resNFe.
             */
            const cnpjConsultado =
                String(
                    consultaResult.cnpj ?? '',
                ).replace(/\D/g, '');

            const cStatConsulta =
                String(
                    consultaResult.cStat ?? '',
                ).trim();

            const xMotivoConsulta =
                String(
                    consultaResult.xMotivo ?? '',
                ).trim();

            const ultNSURetornado =
                String(
                    consultaResult.ultNSU ?? '',
                ).replace(/\D/g, '');

            const maxNSURetornado =
                String(
                    consultaResult.maxNSU ?? '',
                ).replace(/\D/g, '');

            const newUltNSU =
                ultNSURetornado !== ''
                    ? parseInt(
                        ultNSURetornado,
                        10,
                    )
                    : ultNSU;

            const novoMaxNSU =
                maxNSURetornado !== ''
                    ? parseInt(
                        maxNSURetornado,
                        10,
                    )
                    : maxNSU;

            if (
                Number.isNaN(
                    newUltNSU,
                ) ||
                Number.isNaN(
                    novoMaxNSU,
                )
            ) {
                throw new Error(
                    `A SEFAZ retornou NSU inválido. ultNSU=${consultaResult.ultNSU}, maxNSU=${consultaResult.maxNSU}.`,
                );
            }

            /*
             * cStat 137:
             * nenhum documento localizado.
             */
            if (
                cStatConsulta === '137'
            ) {
                ultNSU =
                    newUltNSU;

                maxNSU =
                    novoMaxNSU;

                todasMensagens.push(
                    `${xMotivoConsulta || 'Nenhum documento localizado'}. Aguardar pelo menos 1 hora antes da próxima consulta.`,
                );

                keepGoing = false;
                break;
            }

            /*
             * cStat 656:
             * consumo indevido.
             */
            if (
                cStatConsulta === '656'
            ) {
                ultNSU =
                    newUltNSU;

                maxNSU =
                    novoMaxNSU;

                throw new Error(
                    `Consumo indevido informado pela SEFAZ: ${xMotivoConsulta}`,
                );
            }

            /*
             * Apenas cStat 138 permite processar os documentos.
             */
            if (
                cStatConsulta !== '138'
            ) {
                ultNSU =
                    newUltNSU;

                maxNSU =
                    novoMaxNSU;

                throw new Error(
                    `A SEFAZ retornou cStat=${cStatConsulta}: ${xMotivoConsulta}`,
                );
            }

            /*
             * Impede loop sem avanço do ultNSU.
             */
            if (
                newUltNSU <= ultNSU &&
                newUltNSU < novoMaxNSU
            ) {
                throw new Error(
                    `A SEFAZ não avançou o ultNSU. Atual=${ultNSU}, retornado=${newUltNSU}, maxNSU=${novoMaxNSU}.`,
                );
            }

            documentosEncontrados +=
                consultaResult
                    .documentos
                    ?.length ?? 0;

            for (
                const doc of
                consultaResult
                    .documentos ?? []
            ) {
                if (!doc.xml) {
                    continue;
                }

                /*
                 * Normaliza o NSU individual.
                 */
                const nsuLimpo =
                    String(
                        doc.nsu ?? '',
                    ).replace(/\D/g, '');

                const nsuNumerico =
                    nsuLimpo !== ''
                        ? parseInt(
                            nsuLimpo,
                            10,
                        )
                        : null;

                if (
                    nsuNumerico !== null &&
                    Number.isNaN(
                        nsuNumerico,
                    )
                ) {
                    todasMensagens.push(
                        `Documento ignorado por possuir NSU inválido: ${doc.nsu}.`,
                    );

                    continue;
                }

                const schema =
                    String(
                        doc.schema ?? '',
                    );

                let parsedInfo:
                    ParsedDocInfo;

                try {
                    if (
                        schema.includes(
                            'resNFe',
                        )
                    ) {
                        parsedInfo =
                            parseResNFe(
                                doc.xml,
                            );
                    } else if (
                        schema.includes(
                            'procNFe',
                        )
                    ) {
                        parsedInfo =
                            extractCnpjFromXml(
                                doc.xml,
                            );
                    } else if (
                        schema.includes(
                            'resEvento',
                        ) ||
                        schema.includes(
                            'procEventoNFe',
                        )
                    ) {
                        continue;
                    } else {
                        parsedInfo =
                            extractCnpjFromXml(
                                doc.xml,
                            );
                    }
                } catch (parseError) {
                    todasMensagens.push(
                        `Erro ao interpretar documento NSU=${doc.nsu}, schema=${schema}: ${parseError instanceof Error
                            ? parseError.message
                            : String(
                                parseError,
                            )
                        }`,
                    );

                    continue;
                }

                if (
                    !parsedInfo.chave
                ) {
                    todasMensagens.push(
                        `Documento ignorado por não possuir chave de acesso. NSU=${doc.nsu}, schema=${schema}.`,
                    );

                    continue;
                }

                let unidade: any =
                    null;

                let cnpjUnidade:
                    string | null =
                    null;

                const destCnpjNormalizado =
                    parsedInfo.destCnpj
                        ? String(
                            parsedInfo
                                .destCnpj,
                        ).replace(
                            /\D/g,
                            '',
                        )
                        : null;

                const emitCnpjNormalizado =
                    parsedInfo.emitCnpj
                        ? String(
                            parsedInfo
                                .emitCnpj,
                        ).replace(
                            /\D/g,
                            '',
                        )
                        : null;

                /*
                 * Primeira tentativa:
                 * CNPJ do destinatário.
                 */
                if (
                    destCnpjNormalizado &&
                    unidadeByCnpj.has(
                        destCnpjNormalizado,
                    )
                ) {
                    unidade =
                        unidadeByCnpj.get(
                            destCnpjNormalizado,
                        );

                    cnpjUnidade =
                        destCnpjNormalizado;

                    /*
                     * Segunda tentativa:
                     * CNPJ utilizado na consulta.
                     */
                } else if (
                    cnpjConsultado &&
                    unidadeByCnpj.has(
                        cnpjConsultado,
                    )
                ) {
                    unidade =
                        unidadeByCnpj.get(
                            cnpjConsultado,
                        );

                    cnpjUnidade =
                        cnpjConsultado;

                    /*
                     * Terceira tentativa:
                     * CNPJ do emitente.
                     */
                } else if (
                    emitCnpjNormalizado &&
                    unidadeByCnpj.has(
                        emitCnpjNormalizado,
                    )
                ) {
                    unidade =
                        unidadeByCnpj.get(
                            emitCnpjNormalizado,
                        );

                    cnpjUnidade =
                        emitCnpjNormalizado;
                }

                const valorTotal =
                    converterValor(
                        parsedInfo.valor,
                    );

                /*
                 * Verifica se a nota já existe.
                 */
                const {
                    rows: existing,
                } = await pool.query(
                    `SELECT *
                       FROM notas
                      WHERE chave_acesso = $1`,
                    [
                        parsedInfo.chave,
                    ],
                );

                /*
                 * Nota já existente.
                 */
                if (
                    existing.length > 0
                ) {
                    const existingNota =
                        existing[0];

                    /*
                     * Se ainda é resumo, atualiza os dados disponíveis,
                     * mas mantém o status existente.
                     */
                    if (
                        !schema.includes(
                            'procNFe',
                        )
                    ) {
                        await pool.query(
                            `UPDATE notas
                                SET nsu = COALESCE($1, nsu),
                                    cnpj_unidade = COALESCE($2, cnpj_unidade),
                                    unidade_id = COALESCE($3, unidade_id),
                                    data_emissao = COALESCE($4, data_emissao),
                                    valor_total = COALESCE($5, valor_total),
                                    updated_at = $6
                              WHERE id = $7`,
                            [
                                nsuNumerico,
                                cnpjUnidade,
                                unidade?.id ??
                                null,
                                parsedInfo
                                    .dataEmissao,
                                valorTotal,
                                new Date()
                                    .toISOString(),
                                existingNota.id,
                            ],
                        );

                        continue;
                    }

                    /*
                     * Chegou procNFe completo para uma nota
                     * anteriormente pendente ou manifestada.
                     */
                    try {
                        const dataReferencia =
                            obterDataReferencia(
                                parsedInfo
                                    .dataEmissao,
                            );

                        const ano =
                            dataReferencia
                                .getFullYear();

                        const mes =
                            String(
                                dataReferencia
                                    .getMonth() +
                                1,
                            ).padStart(
                                2,
                                '0',
                            );

                        const diretorioCnpj =
                            cnpjUnidade ||
                            existingNota
                                .cnpj_unidade ||
                            'nao-identificado';

                        const xmlPath =
                            `${diretorioCnpj}/${ano}/${mes}/${parsedInfo.chave}.xml`;

                        const xmlBytes =
                            Buffer.from(
                                doc.xml,
                                'utf-8',
                            );

                        saveFile(
                            xmlPath,
                            xmlBytes,
                        );

                        xmlsBaixados++;

                        let pdfPath:
                            string | null =
                            existingNota
                                .pdf_path ??
                            null;

                        try {
                            const danfeResult =
                                await gerarDanfe(
                                    doc.xml,
                                    parsedInfo
                                        .chave,
                                    diretorioCnpj,
                                    parsedInfo
                                        .dataEmissao,
                                );

                            if (
                                danfeResult
                                    .success
                            ) {
                                danfesGerados++;

                                pdfPath =
                                    danfeResult
                                        .pdfPath;
                            } else {
                                todasMensagens.push(
                                    `DANFE não gerado para ${parsedInfo.chave}.`,
                                );
                            }
                        } catch (
                        danfeError
                        ) {
                            const mensagemDanfe =
                                danfeError instanceof
                                    Error
                                    ? danfeError
                                        .message
                                    : String(
                                        danfeError,
                                    );

                            todasMensagens.push(
                                `Erro ao gerar DANFE para ${parsedInfo.chave}: ${mensagemDanfe}`,
                            );
                        }

                        await pool.query(
                            `UPDATE notas
                                SET cnpj_unidade = COALESCE($1, cnpj_unidade),
                                    unidade_id = COALESCE($2, unidade_id),
                                    data_emissao = COALESCE($3, data_emissao),
                                    nsu = COALESCE($4, nsu),
                                    status = 'baixada',
                                    valor_total = COALESCE($5, valor_total),
                                    xml_path = $6,
                                    pdf_path = COALESCE($7, pdf_path),
                                    updated_at = $8
                              WHERE id = $9`,
                            [
                                cnpjUnidade,
                                unidade?.id ??
                                null,
                                parsedInfo
                                    .dataEmissao,
                                nsuNumerico,
                                valorTotal,
                                xmlPath,
                                pdfPath,
                                new Date()
                                    .toISOString(),
                                existingNota.id,
                            ],
                        );
                    } catch (
                    fileError
                    ) {
                        const mensagemArquivo =
                            fileError instanceof
                                Error
                                ? fileError
                                    .message
                                : String(
                                    fileError,
                                );

                        todasMensagens.push(
                            `Erro ao atualizar XML da nota ${parsedInfo.chave}: ${mensagemArquivo}`,
                        );
                    }

                    continue;
                }

                /*
                 * Nota ainda não existente.
                 */
                const notaStatus =
                    schema.includes(
                        'procNFe',
                    )
                        ? 'baixada'
                        : 'pendente';

                const insertResult =
                    await pool.query(
                        `INSERT INTO notas
                            (
                                chave_acesso,
                                cnpj_unidade,
                                unidade_id,
                                data_emissao,
                                nsu,
                                status,
                                valor_total
                            )
                         VALUES
                            ($1, $2, $3, $4, $5, $6, $7)
                         RETURNING *`,
                        [
                            parsedInfo.chave,
                            cnpjUnidade,
                            unidade?.id ??
                            null,
                            parsedInfo
                                .dataEmissao,
                            nsuNumerico,
                            notaStatus,
                            valorTotal,
                        ],
                    );

                const newNota =
                    insertResult.rows[0];

                /*
                 * Se o documento já é procNFe,
                 * salva XML e gera o DANFE.
                 */
                if (
                    schema.includes(
                        'procNFe',
                    ) &&
                    newNota
                ) {
                    try {
                        const dataReferencia =
                            obterDataReferencia(
                                parsedInfo
                                    .dataEmissao,
                            );

                        const ano =
                            dataReferencia
                                .getFullYear();

                        const mes =
                            String(
                                dataReferencia
                                    .getMonth() +
                                1,
                            ).padStart(
                                2,
                                '0',
                            );

                        const diretorioCnpj =
                            cnpjUnidade ||
                            'nao-identificado';

                        const xmlPath =
                            `${diretorioCnpj}/${ano}/${mes}/${parsedInfo.chave}.xml`;

                        const xmlBytes =
                            Buffer.from(
                                doc.xml,
                                'utf-8',
                            );

                        saveFile(
                            xmlPath,
                            xmlBytes,
                        );

                        xmlsBaixados++;

                        let pdfPath:
                            string | null =
                            null;

                        try {
                            const danfeResult =
                                await gerarDanfe(
                                    doc.xml,
                                    parsedInfo
                                        .chave,
                                    diretorioCnpj,
                                    parsedInfo
                                        .dataEmissao,
                                );

                            if (
                                danfeResult
                                    .success
                            ) {
                                danfesGerados++;

                                pdfPath =
                                    danfeResult
                                        .pdfPath;
                            } else {
                                todasMensagens.push(
                                    `DANFE não gerado para ${parsedInfo.chave}.`,
                                );
                            }
                        } catch (
                        danfeError
                        ) {
                            const mensagemDanfe =
                                danfeError instanceof
                                    Error
                                    ? danfeError
                                        .message
                                    : String(
                                        danfeError,
                                    );

                            todasMensagens.push(
                                `Erro ao gerar DANFE para ${parsedInfo.chave}: ${mensagemDanfe}`,
                            );
                        }

                        await pool.query(
                            `UPDATE notas
                                SET xml_path = $1,
                                    pdf_path = COALESCE($2, pdf_path),
                                    status = 'baixada',
                                    updated_at = $3
                              WHERE id = $4`,
                            [
                                xmlPath,
                                pdfPath,
                                new Date()
                                    .toISOString(),
                                newNota.id,
                            ],
                        );
                    } catch (
                    fileError
                    ) {
                        const mensagemArquivo =
                            fileError instanceof
                                Error
                                ? fileError
                                    .message
                                : String(
                                    fileError,
                                );

                        todasMensagens.push(
                            `Erro ao salvar XML para ${parsedInfo.chave}: ${mensagemArquivo}`,
                        );
                    }
                }
            }

            /*
             * Atualiza os NSUs somente após processar o lote.
             */
            ultNSU =
                newUltNSU;

            maxNSU =
                novoMaxNSU;

            if (
                ultNSU >= maxNSU
            ) {
                keepGoing = false;
            }

            /*
             * Proteção contra resposta 138 sem documentos.
             */
            if (
                (
                    consultaResult
                        .documentos
                        ?.length ?? 0
                ) === 0 &&
                ultNSU < maxNSU
            ) {
                todasMensagens.push(
                    `A SEFAZ retornou cStat 138 sem documentos processáveis. ultNSU=${ultNSU}, maxNSU=${maxNSU}.`,
                );

                keepGoing = false;
            }
        }

        /*
         * Manifestação automática.
         */
        const {
            rows: pendingNotas,
        } = await pool.query(
            `SELECT *
               FROM notas
              WHERE status = 'pendente'
                AND unidade_id IS NOT NULL
              ORDER BY nsu ASC NULLS LAST`,
        );

        for (
            const nota of
            pendingNotas
        ) {
            try {
                const manifestResult =
                    await manifestarSefaz(
                        nota.chave_acesso,
                        ambiente,
                    );

                if (
                    manifestResult.success
                ) {
                    notasManifestadas++;

                    await pool.query(
                        `UPDATE notas
                            SET manifesto_enviado = true,
                                status = 'manifestada',
                                updated_at = $1
                          WHERE id = $2`,
                        [
                            new Date()
                                .toISOString(),
                            nota.id,
                        ],
                    );
                } else {
                    todasMensagens.push(
                        `Manifestação não aceita para ${nota.chave_acesso}: ${manifestResult
                            .xMotivoEvento ||
                        manifestResult
                            .xMotivoLote
                        }`,
                    );
                }
            } catch (
            manifestError
            ) {
                const mensagemManifestacao =
                    manifestError instanceof
                        Error
                        ? manifestError
                            .message
                        : String(
                            manifestError,
                        );

                todasMensagens.push(
                    `Erro ao manifestar ${nota.chave_acesso}: ${mensagemManifestacao}`,
                );
            }
        }

        const mensagem =
            todasMensagens.length > 0
                ? todasMensagens.join(
                    '; ',
                )
                : `Sincronização concluída. ${documentosEncontrados} documentos, ${notasManifestadas} manifestações, ${xmlsBaixados} XMLs, ${danfesGerados} DANFEs.`;

        await pool.query(
            `UPDATE sync_control
                SET ult_nsu = $1,
                    max_nsu = $2,
                    status_ultima_execucao = 'sucesso',
                    ultima_execucao = $3,
                    documentos_processados = $4,
                    mensagem = $5
              WHERE id = 1`,
            [
                ultNSU,
                maxNSU,
                new Date()
                    .toISOString(),
                documentosEncontrados,
                mensagem,
            ],
        );

        return {
            success: true,
            documentosEncontrados,
            notasManifestadas,
            xmlsBaixados,
            danfesGerados,
            ultNSU,
            maxNSU,
            mensagem,
        };
    } catch (error) {
        const mensagemErro =
            error instanceof Error
                ? error.message
                : String(error);

        try {
            await pool.query(
                `UPDATE sync_control
                    SET ult_nsu = $1,
                        max_nsu = $2,
                        status_ultima_execucao = 'erro',
                        ultima_execucao = $3,
                        documentos_processados = $4,
                        mensagem = $5
                  WHERE id = 1`,
                [
                    ultNSU,
                    maxNSU,
                    new Date()
                        .toISOString(),
                    documentosEncontrados,
                    mensagemErro,
                ],
            );
        } catch (updateError) {
            console.error(
                'Erro ao atualizar o status da sincronização:',
                updateError,
            );
        }

        throw error;
    }
}