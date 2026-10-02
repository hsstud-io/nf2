import axios from 'axios';
import https from 'node:https';
import forge from 'node-forge';
import * as zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { pool } from '../db.js';

const SEFAZ_HOMOLOGACAO = 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
const SEFAZ_PRODUCAO = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

const EVENTO_HOMOLOGACAO = 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento/NFeRecepcaoEvento.asmx';
const EVENTO_PRODUCAO = 'https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento/NFeRecepcaoEvento.asmx';

const DISTRIBUICAO_DFE_ACTION = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';

const UF_CODES: Record<string, string> = {
    AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
    CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
    MT: '51', MS: '50', MG: '31', PA: '15', PB: '25',
    PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24',
    RS: '43', RO: '11', RR: '14', SC: '42', SP: '35',
    SE: '28', TO: '17',
};

interface CertPem {
    certPem: string;
    keyPem: string;
    chainPem: string[];
}

function normalizeStoredBase64(
    fileBase64: string,
): string {
    return fileBase64
        .replace(
            /^data:application\/x-pkcs12;base64,/i,
            '',
        )
        .replace(
            /^data:application\/pkcs12;base64,/i,
            '',
        )
        .replace(
            /^data:application\/octet-stream;base64,/i,
            '',
        )
        .replace(
            /^data:[^;]+;base64,/i,
            '',
        )
        .replace(/\s/g, '');
}

function isCertificateAuthority(
    cert: forge.pki.Certificate,
): boolean {
    const basicConstraints = cert.getExtension(
        'basicConstraints',
    ) as unknown as {
        cA?: boolean;
    } | null;

    return basicConstraints?.cA === true;
}

function extractPemFromPfx(
    pfxBase64: string,
    senha: string,
): CertPem {
    const normalizedBase64 =
        normalizeStoredBase64(pfxBase64);

    if (!normalizedBase64) {
        throw new Error(
            'O conteÃºdo do certificado armazenado estÃ¡ vazio.',
        );
    }

    const pfxBuffer = Buffer.from(
        normalizedBase64,
        'base64',
    );

    if (pfxBuffer.length === 0) {
        throw new Error(
            'NÃ£o foi possÃ­vel decodificar o certificado armazenado.',
        );
    }

    let p12Asn1: forge.asn1.Asn1;

    try {
        const binary = pfxBuffer.toString('binary');

        p12Asn1 = forge.asn1.fromDer(
            forge.util.createBuffer(binary),
        );
    } catch (error) {
        console.error(
            'Erro ao interpretar a estrutura ASN.1 do PFX:',
            error instanceof Error
                ? error.message
                : String(error),
        );

        throw new Error(
            'O certificado armazenado nÃ£o possui uma estrutura PKCS#12 vÃ¡lida.',
        );
    }

    let p12: forge.pkcs12.Pkcs12Pfx;

    try {
        p12 = forge.pkcs12.pkcs12FromAsn1(
            p12Asn1,
            false,
            senha,
        );
    } catch (error) {
        console.error(
            'Erro ao abrir o PFX para comunicaÃ§Ã£o com a SEFAZ:',
            error instanceof Error
                ? error.message
                : String(error),
        );

        throw new Error(
            'NÃ£o foi possÃ­vel abrir o certificado cadastrado. Verifique a senha e o conteÃºdo do PFX.',
        );
    }

    /*
     * Extrai os certificados X.509.
     */
    const certBags = p12.getBags({
        bagType: forge.pki.oids.certBag,
    });

    const certificates = (
        certBags[forge.pki.oids.certBag] ?? []
    )
        .map((bag) => bag.cert)
        .filter(
            (
                cert,
            ): cert is forge.pki.Certificate =>
                cert !== undefined,
        );

    if (certificates.length === 0) {
        throw new Error(
            'Nenhum certificado X.509 foi encontrado no PFX cadastrado.',
        );
    }

    /*
     * Procura primeiro a chave privada protegida;
     * depois procura uma chave privada sem proteÃ§Ã£o.
     */
    const encryptedKeyBags = p12.getBags({
        bagType:
            forge.pki.oids.pkcs8ShroudedKeyBag,
    });

    const plainKeyBags = p12.getBags({
        bagType: forge.pki.oids.keyBag,
    });

    const encryptedKey =
        encryptedKeyBags[
            forge.pki.oids.pkcs8ShroudedKeyBag
        ]?.find((bag) => bag.key)?.key;

    const plainKey =
        plainKeyBags[
            forge.pki.oids.keyBag
        ]?.find((bag) => bag.key)?.key;

    const privateKey =
        encryptedKey ??
        plainKey ??
        null;

    if (!privateKey) {
        throw new Error(
            'Nenhuma chave privada foi encontrada no PFX cadastrado.',
        );
    }

    /*
     * O certificado A1 principal normalmente Ã© o certificado
     * que nÃ£o possui basicConstraints CA=true.
     */
    const mainCertificate =
        certificates.find(
            (cert) =>
                !isCertificateAuthority(cert),
        ) ?? certificates[0];

    /*
     * Os demais certificados encontrados no PFX
     * representam a cadeia intermediÃ¡ria ou raiz.
     */
    const chainCertificates =
        certificates.filter(
            (cert) => cert !== mainCertificate,
        );

    const certPem =
        forge.pki.certificateToPem(
            mainCertificate,
        );

    const keyPem =
        forge.pki.privateKeyToPem(
            privateKey,
        );

    const chainPem =
        chainCertificates.map((cert) =>
            forge.pki.certificateToPem(cert),
        );

    return {
        certPem,
        keyPem,
        chainPem,
    };
}

async function getCertPem(): Promise<CertPem> {
    const { rows } = await pool.query(
        `SELECT pfx_base64, senha
       FROM certificado_dados
      WHERE id = 1`,
    );

    if (
        rows.length === 0 ||
        !rows[0].pfx_base64 ||
        rows[0].pfx_base64 === 'placeholder'
    ) {
        throw new Error(
            'Nenhum certificado cadastrado. FaÃ§a upload do certificado primeiro.',
        );
    }

    if (
        typeof rows[0].senha !== 'string' ||
        !rows[0].senha
    ) {
        throw new Error(
            'A senha do certificado cadastrado nÃ£o foi encontrada.',
        );
    }

    return extractPemFromPfx(
        String(rows[0].pfx_base64),
        String(rows[0].senha),
    );
}

async function createSefazHttpsAgent(): Promise<https.Agent> {
    const pem = await getCertPem();

    /*
     * Anexa a cadeia intermediÃ¡ria ao certificado cliente.
     *
     * NÃ£o usamos a propriedade "ca" porque ela substituiria
     * a lista padrÃ£o de autoridades confiÃ¡veis do Node.js.
     */
    const certWithChain = [
        pem.certPem,
        ...pem.chainPem,
    ].join('\n');

    return new https.Agent({
        cert: certWithChain,
        key: pem.keyPem,
        rejectUnauthorized: true,
        keepAlive: true,
        minVersion: 'TLSv1.2',
    });
}

async function getCertMeta(): Promise<{ cnpj: string; cnpj_raiz: string | null }> {
    const { rows } = await pool.query(
        'SELECT cnpj, cnpj_raiz FROM certificado WHERE id = 1'
    );

    if (rows.length === 0 || !rows[0].cnpj) {
        throw new Error('Metadados do certificado nÃ£o encontrados.');
    }

    return { cnpj: rows[0].cnpj, cnpj_raiz: rows[0].cnpj_raiz };
}

function buildSoapEnvelope(
    tpAmb: string,
    cUFAutor: string,
    cnpj: string,
    ultNSU: string,
): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:nfe="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
  <soap12:Body>
    <nfe:nfeDistDFeInteresse>
      <nfe:nfeDadosMsg>
        <distDFeInt
          xmlns="http://www.portalfiscal.inf.br/nfe"
          versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUFAutor}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfe:nfeDadosMsg>
    </nfe:nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

function buildEventoSoapEnvelope(
    tpAmb: string,
    cUFAutor: string,
    cnpj: string,
    chaveAcesso: string,
    eventoId: string,
): string {
    const dhEvento = new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00');
    const nSeqEvento = '1';
    const tpEvento = '210210';
    const descEvento = 'Ciencia da Operacao';

    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:nfe="http://www.portalfiscal.inf.br/nfe">
  <soap:Body>
    <nfe:nfeRecepcaoEvento>
      <nfe:nfeDadosMsg>
        <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
          <idLote>${eventoId}</idLote>
          <evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
            <infEvento Id="ID${tpEvento}${chaveAcesso}${nSeqEvento}">
              <cOrgao>${cUFAutor}</cOrgao>
              <tpAmb>${tpAmb}</tpAmb>
              <CNPJ>${cnpj}</CNPJ>
              <chNFe>${chaveAcesso}</chNFe>
              <dhEvento>${dhEvento}</dhEvento>
              <tpEvento>${tpEvento}</tpEvento>
              <nSeqEvento>${nSeqEvento}</nSeqEvento>
              <verEvento>1.00</verEvento>
              <detEvento versao="1.00">
                <descEvento>${descEvento}</descEvento>
              </detEvento>
            </infEvento>
          </evento>
        </envEvento>
      </nfe:nfeDadosMsg>
    </nfe:nfeRecepcaoEvento>
  </soap:Body>
</soap:Envelope>`;
}

function gunzip(base64Data: string): string {
    const buffer = Buffer.from(base64Data, 'base64');
    const decompressed = zlib.gunzipSync(buffer);
    return decompressed.toString('utf-8');
}

function findElement(obj: any, name: string): any {
    if (!obj || typeof obj !== 'object') return null;
    for (const key of Object.keys(obj)) {
        if (key === name || key.endsWith(`:${name}`)) return obj[key];
        const nested = findElement(obj[key], name);
        if (nested !== null) return nested;
    }
    return null;
}

function findAllElements(
    obj: any,
    name: string,
    results: any[] = [],
): any[] {
    if (!obj || typeof obj !== 'object') {
        return results;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            findAllElements(
                item,
                name,
                results,
            );
        }

        return results;
    }

    for (const key of Object.keys(obj)) {
        const value = obj[key];

        if (
            key === name ||
            key.endsWith(`:${name}`)
        ) {
            if (Array.isArray(value)) {
                results.push(...value);
            } else {
                results.push(value);
            }

            /*
             * O elemento encontrado jÃ¡ foi adicionado.
             * NÃ£o Ã© necessÃ¡rio percorrer novamente o
             * prÃ³prio docZip para procurar outro docZip.
             */
            continue;
        }

        findAllElements(
            value,
            name,
            results,
        );
    }

    return results;
}

export async function consultarSefaz(
    ultNSU: string,
    ambiente: string,
    cnpjConsulta?: string,
): Promise<{
    cStat: string;
    xMotivo: string;
    ultNSU: string;
    maxNSU: string;
    cnpj: string;
    cnpj_raiz: string | null;
    documentos: {
        nsu: string;
        schema: string;
        xml: string | null;
    }[];
}> {
    if (
        ambiente !== '1' &&
        ambiente !== '2'
    ) {
        throw new Error(
            `Ambiente inválido: ${ambiente}. Utilize 1 para produção ou 2 para homologação.`,
        );
    }

    /*
     * Normaliza o NSU recebido.
     */
    const ultNSULimpo =
        String(
            ultNSU ?? '0',
        ).replace(/\D/g, '');

    const ultNSUNumerico =
        ultNSULimpo || '0';

    if (
        ultNSUNumerico.length > 15
    ) {
        throw new Error(
            `ultNSU inválido: ${ultNSU}. O valor não pode ultrapassar 15 posições.`,
        );
    }

    const ultNSUFormatado =
        ultNSUNumerico.padStart(
            15,
            '0',
        );

    /*
     * Carrega o certificado antes da chamada.
     */
    const httpsAgent =
        await createSefazHttpsAgent();

    const {
        cnpj: cnpjCertificado,
        cnpj_raiz: cnpjRaizCertificado,
    } = await getCertMeta();

    const cnpjCertificadoNormalizado =
        String(cnpjCertificado)
            .replace(/\D/g, '');

    if (
        !/^\d{14}$/.test(
            cnpjCertificadoNormalizado,
        )
    ) {
        throw new Error(
            `O CNPJ extraído do certificado é inválido. Valor encontrado: ${cnpjCertificado}`,
        );
    }

    const cnpjConsultaNormalizado =
        String(
            cnpjConsulta ||
            cnpjCertificadoNormalizado,
        ).replace(/\D/g, '');

    if (
        !/^\d{14}$/.test(
            cnpjConsultaNormalizado,
        )
    ) {
        throw new Error(
            `O CNPJ informado para consulta é inválido: ${cnpjConsulta}.`,
        );
    }

    const raizCertificado =
        cnpjCertificadoNormalizado.substring(
            0,
            8,
        );

    const raizConsulta =
        cnpjConsultaNormalizado.substring(
            0,
            8,
        );

    if (
        raizCertificado !== raizConsulta
    ) {
        throw new Error(
            `O CNPJ consultado pertence à raiz ${raizConsulta}, mas o certificado pertence à raiz ${raizCertificado}.`,
        );
    }

    const raizArmazenada =
        String(cnpjRaizCertificado ?? '')
            .replace(/\D/g, '')
            .substring(0, 8);

    if (
        raizArmazenada &&
        raizArmazenada !== raizCertificado
    ) {
        throw new Error(
            `O CNPJ-base armazenado para o certificado está inconsistente. Armazenado=${raizArmazenada}, calculado=${raizCertificado}.`,
        );
    }

    const uf = 'SP';

    const ufCode =
        UF_CODES[uf] || '35';

    console.log(
        '[SEFAZ] Consulta NFeDistribuicaoDFe:',
        {
            certificadoMascarado:
                `${cnpjCertificadoNormalizado.substring(0, 8)}****${cnpjCertificadoNormalizado.substring(12)}`,

            cnpjConsultadoMascarado:
                `${cnpjConsultaNormalizado.substring(0, 8)}****${cnpjConsultaNormalizado.substring(12)}`,

            raizCertificado,
            raizConsulta,

            ultNSU:
                ultNSUFormatado,

            ambiente,
        },
    );

    const soapEnvelope =
        buildSoapEnvelope(
            ambiente,
            ufCode,
            cnpjConsultaNormalizado,
            ultNSUFormatado,
        );


    const url =
        ambiente === '1'
            ? SEFAZ_PRODUCAO
            : SEFAZ_HOMOLOGACAO;

    const response =
        await axios.post(
            url,
            soapEnvelope,
            {
                headers: {
                    'Content-Type':
                        `application/soap+xml; charset=utf-8; action="${DISTRIBUICAO_DFE_ACTION}"`,

                    Accept:
                        'application/soap+xml',

                    SOAPAction:
                        `"${DISTRIBUICAO_DFE_ACTION}"`,
                },

                httpsAgent,

                timeout: 60000,

                /*
                 * Permite interpretar SOAP Fault mesmo
                 * quando a SEFAZ retorna HTTP 400 ou 500.
                 */
                validateStatus:
                    () => true,
            },
        );

    if (
        typeof response.data !==
        'string'
    ) {
        throw new Error(
            `A SEFAZ retornou conteúdo inválido. HTTP ${response.status}.`,
        );
    }

    const responseXml =
        response.data;

    const responseParser =
        new XMLParser({
            ignoreAttributes: false,
            removeNSPrefix: false,
            parseTagValue: false,
        });

    let parsed: any;

    try {
        parsed =
            responseParser.parse(
                responseXml,
            );
    } catch (error) {
        throw new Error(
            `Não foi possível interpretar o XML retornado pela SEFAZ. HTTP ${response.status}. Erro: ${error instanceof Error
                ? error.message
                : String(error)
            }. Conteúdo: ${responseXml.substring(0, 500)}`,
        );
    }

    /*
     * Verifica SOAP Fault antes de verificar o status HTTP.
     */
    const fault =
        findElement(
            parsed,
            'Fault',
        );

    if (fault) {
        const faultReason =
            findElement(
                fault,
                'Text',
            ) ||
            findElement(
                fault,
                'faultstring',
            ) ||
            findElement(
                fault,
                'Reason',
            ) ||
            JSON.stringify(fault);

        throw new Error(
            `Erro SOAP Sefaz: ${String(
                faultReason,
            ).substring(0, 1000)}`,
        );
    }

    if (
        response.status < 200 ||
        response.status >= 300
    ) {
        throw new Error(
            `A SEFAZ retornou HTTP ${response.status}: ${responseXml.substring(0, 500)}`,
        );
    }

    const retDistDFeInt =
        findElement(
            parsed,
            'retDistDFeInt',
        );

    if (!retDistDFeInt) {
        throw new Error(
            `A resposta da SEFAZ não contém retDistDFeInt. HTTP ${response.status}. Conteúdo: ${responseXml.substring(0, 500)}`,
        );
    }

    const cStat =
        findElement(
            retDistDFeInt,
            'cStat',
        );

    const xMotivo =
        findElement(
            retDistDFeInt,
            'xMotivo',
        );

    const respUltNSU =
        findElement(
            retDistDFeInt,
            'ultNSU',
        );

    const maxNSU =
        findElement(
            retDistDFeInt,
            'maxNSU',
        );

    /*
     * A validação precisa acontecer antes do return.
     *
     * Esse era um dos pontos quebrados no código anterior.
     */
    if (
        cStat === null ||
        cStat === undefined ||
        String(cStat).trim() === ''
    ) {
        throw new Error(
            `Resposta da SEFAZ sem cStat. Conteúdo: ${responseXml.substring(0, 500)}`,
        );
    }

    const cStatRetornado =
        String(cStat).trim();

    const xMotivoRetornado =
        String(
            xMotivo ?? '',
        ).trim();

    const ultNSURetornado =
        respUltNSU !== null &&
            respUltNSU !== undefined
            ? String(
                respUltNSU,
            ).trim()
            : '';

    const maxNSURetornado =
        maxNSU !== null &&
            maxNSU !== undefined
            ? String(
                maxNSU,
            ).trim()
            : '';

    const docZips =
        findAllElements(
            retDistDFeInt,
            'docZip',
        );

    console.log(
        '[SEFAZ] Resultado da distribuição:',
        {
            cStat:
                cStatRetornado,

            xMotivo:
                xMotivoRetornado,

            ultNSU:
                ultNSURetornado,

            maxNSU:
                maxNSURetornado,

            quantidadeDocZip:
                docZips.length,
        },
    );

    const documentos: {
        nsu: string;
        schema: string;
        xml: string | null;
    }[] = [];

    for (const docZip of docZips) {
        if (!docZip) {
            console.warn(
                '[SEFAZ] docZip vazio ou nulo.',
            );

            continue;
        }

        const nsu =
            typeof docZip === 'object'
                ? String(
                    docZip['@_NSU'] ?? '',
                )
                : '';

        const schema =
            typeof docZip === 'object'
                ? String(
                    docZip['@_schema'] ?? '',
                )
                : '';

        const base64Content =
            typeof docZip === 'object'
                ? String(
                    docZip['#text'] ?? '',
                )
                : String(docZip);

        console.log(
            '[SEFAZ] Documento recebido:',
            {
                nsu,
                schema,
                tamanhoBase64:
                    base64Content.length,
            },
        );

        if (!base64Content.trim()) {
            console.warn(
                '[SEFAZ] docZip sem conteúdo:',
                {
                    nsu,
                    schema,
                    tipoDocZip:
                        typeof docZip,
                    propriedades:
                        typeof docZip === 'object'
                            ? Object.keys(docZip)
                            : [],
                },
            );

            documentos.push({
                nsu,
                schema,
                xml: null,
            });

            continue;
        }

        try {
            const decompressed =
                gunzip(
                    base64Content.trim(),
                );

            console.log(
                '[SEFAZ] Documento descompactado:',
                {
                    nsu,
                    schema,
                    tamanhoXml:
                        decompressed.length,

                    inicioXml:
                        decompressed
                            .substring(0, 150)
                            .replace(/\s+/g, ' '),
                },
            );

            documentos.push({
                nsu,
                schema,
                xml: decompressed,
            });
        } catch (error) {
            console.error(
                '[SEFAZ] Erro ao descompactar docZip:',
                {
                    nsu,
                    schema,
                    tamanhoBase64:
                        base64Content.length,

                    erro:
                        error instanceof Error
                            ? error.message
                            : String(error),
                },
            );

            documentos.push({
                nsu,
                schema,
                xml: null,
            });
        }
    }

    return {
        cStat:
            cStatRetornado,

        xMotivo:
            xMotivoRetornado,

        ultNSU:
            ultNSURetornado,

        maxNSU:
            maxNSURetornado,

        cnpj:
            cnpjConsultaNormalizado,
        
        cnpj_raiz:
            raizConsulta,

        documentos,
    };
}

export async function manifestarSefaz(
    chaveAcesso: string,
    ambiente: string,
): Promise<{
    success: boolean;
    cStatLote: string;
    xMotivoLote: string;
    cStatEvento: string;
    xMotivoEvento: string;
    chaveAcesso: string;
}> {
    if (
        ambiente !== '1' &&
        ambiente !== '2'
    ) {
        throw new Error(
            `Ambiente inválido: ${ambiente}. Utilize 1 para produção ou 2 para homologação.`,
        );
    }

    const chaveNormalizada =
        String(chaveAcesso ?? '')
            .replace(/\D/g, '');

    if (
        !/^\d{44}$/.test(
            chaveNormalizada,
        )
    ) {
        throw new Error(
            `Chave de acesso inválida: ${chaveAcesso}. A chave deve possuir 44 dígitos.`,
        );
    }

    const httpsAgent =
        await createSefazHttpsAgent();

    const { cnpj } =
        await getCertMeta();

    const cnpjNormalizado =
        String(cnpj)
            .replace(/\D/g, '');

    if (
        !/^\d{14}$/.test(
            cnpjNormalizado,
        )
    ) {
        throw new Error(
            `O CNPJ extraído do certificado é inválido. Valor encontrado: ${cnpj}`,
        );
    }

    const ufCode =
        UF_CODES.SP || '35';

    const eventoId =
        Date.now().toString();

    const soapEnvelope =
        buildEventoSoapEnvelope(
            ambiente,
            ufCode,
            cnpjNormalizado,
            chaveNormalizada,
            eventoId,
        );


    const url =
        ambiente === '1'
            ? EVENTO_PRODUCAO
            : EVENTO_HOMOLOGACAO;

    console.log(
        '[SEFAZ] Manifestação enviada:',
        {
            cnpjMascarado:
                `${cnpjNormalizado.substring(0, 8)}****${cnpjNormalizado.substring(12)}`,
            chaveMascarada:
                `${chaveNormalizada.substring(0, 6)}...${chaveNormalizada.substring(38)}`,
            ambiente,
            eventoId,
        },
    );
    const response =
        await axios.post(
            url,
            soapEnvelope,
            {
                headers: {
                    'Content-Type':
                        'application/soap+xml; charset=utf-8',
                    Accept:
                        'application/soap+xml',
                },

                httpsAgent,

                timeout: 60000,

                /*
                 * Permite interpretar SOAP Fault mesmo
                 * quando o serviço retornar HTTP 400 ou 500.
                 */
                validateStatus:
                    () => true,
            },
        );

    if (
        typeof response.data !==
        'string'
    ) {
        throw new Error(
            `A SEFAZ retornou conteúdo inválido na manifestação. HTTP ${response.status}.`,
        );
    }

    const responseXml =
        response.data;

    const responseParser =
        new XMLParser({
            ignoreAttributes: false,
            removeNSPrefix: false,
            parseTagValue: false,
        });

    let parsed: any;

    try {
        parsed =
            responseParser.parse(
                responseXml,
            );
    } catch (error) {
        throw new Error(
            `Não foi possível interpretar o XML retornado na manifestação. HTTP ${response.status}. Erro: ${error instanceof Error
                ? error.message
                : String(error)
            }. Conteúdo: ${responseXml.substring(0, 500)}`,
        );
    }

    const fault =
        findElement(
            parsed,
            'Fault',
        );

    if (fault) {
        const faultReason =
            findElement(
                fault,
                'Text',
            ) ||
            findElement(
                fault,
                'faultstring',
            ) ||
            findElement(
                fault,
                'Reason',
            ) ||
            JSON.stringify(fault);

        throw new Error(
            `Erro SOAP na manifestação: ${String(
                faultReason,
            ).substring(0, 1000)}`,
        );
    }

    if (
        response.status < 200 ||
        response.status >= 300
    ) {
        throw new Error(
            `A SEFAZ retornou HTTP ${response.status} na manifestação: ${responseXml.substring(0, 500)}`,
        );
    }

    const retEnvEvento =
        findElement(
            parsed,
            'retEnvEvento',
        );

    if (!retEnvEvento) {
        throw new Error(
            `A resposta da manifestação não contém retEnvEvento. Conteúdo: ${responseXml.substring(0, 500)}`,
        );
    }

    const cStat =
        findElement(
            retEnvEvento,
            'cStat',
        );

    const xMotivo =
        findElement(
            retEnvEvento,
            'xMotivo',
        );

    const retEvento =
        findElement(
            retEnvEvento,
            'retEvento',
        ) ||
        findElement(
            parsed,
            'retEvento',
        );

    const eventoCStat =
        retEvento
            ? findElement(
                retEvento,
                'cStat',
            )
            : null;

    const eventoXMotivo =
        retEvento
            ? findElement(
                retEvento,
                'xMotivo',
            )
            : null;

    const cStatEventoTexto =
        String(
            eventoCStat ?? '',
        ).trim();

    const success =
        cStatEventoTexto === '135' ||
        cStatEventoTexto === '136' ||
        cStatEventoTexto === '573';

    return {
        success,

        cStatLote:
            String(
                cStat ?? '',
            ).trim(),

        xMotivoLote:
            String(
                xMotivo ?? '',
            ).trim(),

        cStatEvento:
            cStatEventoTexto,

        xMotivoEvento:
            String(
                eventoXMotivo ?? '',
            ).trim(),

        chaveAcesso:
            chaveNormalizada,
    };
}