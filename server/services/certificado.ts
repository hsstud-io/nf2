import forge from 'node-forge';
import { pool } from '../db.js';

interface CertInfo {
  cnpj: string | null;
  cnpj_raiz: string | null;
  validade_inicio: string | null;
  validade_fim: string | null;
  emissor: string | null;
  serial: string | null;
}

interface ParsedPfx {
  certInfo: CertInfo;
  certificatePem: string;
  privateKeyPem: string | null;
}

function normalizeBase64(fileBase64: string): string {
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    throw new Error('O conteúdo do certificado não foi informado.');
  }

  const normalized = fileBase64
    .replace(/^data:application\/x-pkcs12;base64,/i, '')
    .replace(/^data:application\/pkcs12;base64,/i, '')
    .replace(/^data:application\/octet-stream;base64,/i, '')
    .replace(/\s/g, '');

  if (!normalized) {
    throw new Error('O conteúdo do certificado está vazio.');
  }

  return normalized;
}

function formatDate(date: Date | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().split('T')[0];
}

function formatSerial(serialNumber: string | undefined): string | null {
  if (!serialNumber) {
    return null;
  }

  const normalized = serialNumber
    .replace(/[^a-fA-F0-9]/g, '')
    .toUpperCase();

  if (!normalized) {
    return null;
  }

  return normalized.match(/.{1,2}/g)?.join(':') ?? normalized;
}

function getAttributeValue(
  attributes: forge.pki.CertificateField[],
  shortName: string,
): string | null {
  const attribute = attributes.find(
    (item) =>
      item.shortName?.toUpperCase() === shortName.toUpperCase(),
  );

  if (!attribute?.value) {
    return null;
  }

  return String(attribute.value).trim() || null;
}

function getIssuer(cert: forge.pki.Certificate): string | null {
  const organization = getAttributeValue(
    cert.issuer.attributes,
    'O',
  );

  if (organization) {
    return organization;
  }

  const commonName = getAttributeValue(
    cert.issuer.attributes,
    'CN',
  );

  if (commonName) {
    return commonName;
  }

  const values = cert.issuer.attributes
    .map((attribute) => String(attribute.value ?? '').trim())
    .filter(Boolean);

  return values.length > 0 ? values.join(', ') : null;
}

function extractCnpjFromText(text: string): string | null {
  if (!text) {
    return null;
  }

  /*
   * Primeiro procura CNPJ formatado:
   * 12.345.678/0001-90
   */
  const formattedMatch = text.match(
    /(?:^|[^\d])(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?:[^\d]|$)/,
  );

  if (formattedMatch) {
    const digits = formattedMatch[1].replace(/\D/g, '');

    if (digits.length === 14) {
      return digits;
    }
  }

  /*
   * Depois procura sequência simples de 14 dígitos.
   */
  const numericMatch = text.match(
    /(?:^|[^\d])(\d{14})(?:[^\d]|$)/,
  );

  return numericMatch?.[1] ?? null;
}

function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) {
    return false;
  }

  if (/^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }

  const calculateDigit = (
    base: string,
    weights: number[],
  ): number => {
    const sum = base
      .split('')
      .reduce(
        (total, digit, index) =>
          total + Number(digit) * weights[index],
        0,
      );

    const remainder = sum % 11;

    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(
    cnpj.substring(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  const secondDigit = calculateDigit(
    cnpj.substring(0, 12) + firstDigit,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  return (
    Number(cnpj[12]) === firstDigit &&
    Number(cnpj[13]) === secondDigit
  );
}

function extractCnpjFromCertificate(
  cert: forge.pki.Certificate,
): string | null {
  /*
   * 1. Prioridade: CNPJ no final do Common Name.
   *
   * Exemplo real:
   * CN=NOVAMED GESTAO DE CLINICAS LTDA:22485085000188
   *
   * Não devemos pesquisar primeiro em todos os atributos,
   * pois campos OU podem conter outros CNPJs que não
   * representam o titular do certificado.
   */
  const commonNameAttribute =
    cert.subject.attributes.find(
      (attribute) =>
        attribute.shortName?.toUpperCase() === 'CN',
    );

  if (commonNameAttribute?.value) {
    const commonName =
      String(commonNameAttribute.value).trim();

    /*
     * Aceita:
     * EMPRESA:12345678000190
     * EMPRESA 12345678000190
     */
    const cnpjNoFinalDoCn =
      commonName.match(
        /(?:^|:|\s)(\d{14})$/,
      );

    if (
      cnpjNoFinalDoCn &&
      isValidCnpj(cnpjNoFinalDoCn[1])
    ) {
      return cnpjNoFinalDoCn[1];
    }
  }

  /*
   * 2. Procura no Subject Alternative Name.
   *
   * Certificados ICP-Brasil de pessoa jurídica armazenam
   * o CNPJ do titular no otherName OID 2.16.76.1.3.3.
   *
   * Dependendo da interpretação do node-forge, o conteúdo
   * pode estar em value ou em bytes DER.
   */
  const subjectAltName =
    cert.getExtension(
      'subjectAltName',
    ) as unknown as {
      altNames?: Array<{
        type?: number;
        value?: string;
        oid?: string;
      }>;
      value?: string;
    } | null;

  if (
    subjectAltName?.altNames &&
    Array.isArray(subjectAltName.altNames)
  ) {
    for (const altName of subjectAltName.altNames) {
      const rawValue =
        String(altName.value ?? '');

      const matches =
        rawValue.match(/\d{14}/g) ?? [];

      for (const match of matches) {
        if (isValidCnpj(match)) {
          return match;
        }
      }
    }
  }

  /*
   * 3. Procura nas extensões DER, mas prioriza o CNPJ que
   * também estiver presente no Common Name.
   *
   * Isso evita retornar o primeiro CNPJ encontrado
   * indiscriminadamente em OU ou em outra extensão.
   */
  try {
    const commonName =
      commonNameAttribute?.value
        ? String(commonNameAttribute.value)
        : '';

    for (const extension of cert.extensions ?? []) {
      const extensionValue =
        extension.value;

      if (!extensionValue) {
        continue;
      }

      const extensionBuffer =
        Buffer.from(
          extensionValue,
          'binary',
        );

      const candidateTexts = [
        extensionBuffer.toString('latin1'),
        extensionBuffer.toString('utf8'),
      ];

      for (const candidateText of candidateTexts) {
        const matches =
          candidateText.match(/\d{14}/g) ?? [];

        /*
         * Primeiro tenta encontrar um candidato que também
         * esteja explicitamente informado no CN.
         */
        for (const match of matches) {
          if (
            commonName.includes(match) &&
            isValidCnpj(match)
          ) {
            return match;
          }
        }
      }
    }
  } catch (error) {
    console.warn(
      'Não foi possível analisar as extensões ICP-Brasil:',
      error instanceof Error
        ? error.message
        : String(error),
    );
  }

  /*
   * 4. Último fallback: aceita somente CNPJ presente
   * diretamente no CN.
   *
   * Não pesquisa mais OU, O ou o certificado DER inteiro,
   * pois isso pode recuperar CNPJ de outro participante.
   */
  if (commonNameAttribute?.value) {
    const matches =
      String(commonNameAttribute.value)
        .match(/\d{14}/g) ?? [];

    for (const match of matches) {
      if (isValidCnpj(match)) {
        return match;
      }
    }
  }

  return null;
}

function isCertificateAuthority(
  cert: forge.pki.Certificate,
): boolean {
  const basicConstraints = cert.getExtension(
    'basicConstraints',
  ) as { cA?: boolean } | null;

  return basicConstraints?.cA === true;
}
function selectMainCertificate(
  certificates: forge.pki.Certificate[],
): forge.pki.Certificate {
  if (certificates.length === 0) {
    throw new Error(
      'Nenhum certificado X.509 foi encontrado no arquivo PFX.',
    );
  }

  /*
   * O PFX pode conter:
   * - certificado da empresa;
   * - certificado intermediário;
   * - certificado raiz.
   *
   * O certificado principal normalmente é o que não possui CA=true.
   */
  const endEntityCertificate = certificates.find(
    (cert) => !isCertificateAuthority(cert),
  );

  return endEntityCertificate ?? certificates[0];
}

function parsePfx(
  fileBase64: string,
  senha: string,
): ParsedPfx {
  const normalizedBase64 = normalizeBase64(fileBase64);

  let pfxData: Buffer;

  try {
    pfxData = Buffer.from(normalizedBase64, 'base64');
  } catch {
    throw new Error(
      'O conteúdo recebido não possui codificação Base64 válida.',
    );
  }

  if (pfxData.length === 0) {
    throw new Error(
      'O arquivo PFX recebido está vazio.',
    );
  }

  let p12Asn1: forge.asn1.Asn1;

  try {
    const pfxBinary = pfxData.toString('binary');

    p12Asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(pfxBinary),
    );
  } catch {
    throw new Error(
      'O arquivo enviado não possui uma estrutura PKCS#12/PFX válida.',
    );
  }

  let p12: forge.pkcs12.Pkcs12Pfx;

  try {
    /*
     * O último argumento é a senha utilizada para descriptografar
     * e validar o conteúdo PKCS#12.
     */
    p12 = forge.pkcs12.pkcs12FromAsn1(
      p12Asn1,
      false,
      senha ?? '',
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : '';

    console.error(
      'Erro ao abrir certificado PKCS#12:',
      detail,
    );

    throw new Error(
      'Não foi possível abrir o certificado PFX. Verifique se o arquivo é válido e se a senha está correta.',
    );
  }

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

  const cert = selectMainCertificate(certificates);

  const keyBags = p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
  });

  const plainKeyBags = p12.getBags({
    bagType: forge.pki.oids.keyBag,
  });

  const privateKey =
    keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
      ?.key ??
    plainKeyBags[forge.pki.oids.keyBag]?.[0]?.key ??
    null;

  const cnpj = extractCnpjFromCertificate(cert);

  const certInfo: CertInfo = {
    cnpj,
    cnpj_raiz:
      cnpj && cnpj.length >= 8
        ? cnpj.substring(0, 8)
        : null,
    validade_inicio: formatDate(cert.validity.notBefore),
    validade_fim: formatDate(cert.validity.notAfter),
    emissor: getIssuer(cert),
    serial: formatSerial(cert.serialNumber),
  };

  return {
    certInfo,
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: privateKey
      ? forge.pki.privateKeyToPem(privateKey)
      : null,
  };
}

export async function parseCertificado(
  fileBase64: string,
  senha: string,
): Promise<CertInfo> {
  const parsed = parsePfx(fileBase64, senha);

  return parsed.certInfo;
}

export async function uploadCertificado(
  fileBase64: string,
  senha: string,
  fileName: string,
): Promise<CertInfo> {
  if (!fileName?.toLowerCase().match(/\.(pfx|p12)$/)) {
    throw new Error(
      'Formato inválido. Envie um certificado com extensão .pfx ou .p12.',
    );
  }

  if (typeof senha !== 'string') {
    throw new Error(
      'A senha do certificado não foi informada.',
    );
  }

  /*
   * A validação do PFX e da senha acontece antes da gravação.
   */
  const parsed =
    parsePfx(
      fileBase64,
      senha,
    );

  const certInfo =
    parsed.certInfo;

  if (!certInfo.cnpj) {
    throw new Error(
      'Não foi possível identificar o CNPJ titular do certificado. Verifique se o arquivo é um e-CNPJ ICP-Brasil válido.',
    );
  }

  if (!certInfo.cnpj_raiz) {
    throw new Error(
      'Não foi possível identificar o CNPJ-base do certificado.',
    );
  }

  if (!parsed.privateKeyPem) {
    throw new Error(
      'O arquivo PFX não contém uma chave privada. Envie um certificado A1 completo, contendo certificado e chave privada.',
    );
  }

  const now =
    new Date().toISOString();

  const client =
    await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO certificado_dados
       (
         id,
         pfx_base64,
         senha,
         arquivo_nome,
         armazenado_em
       )
     VALUES
       (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       pfx_base64 = EXCLUDED.pfx_base64,
       senha = EXCLUDED.senha,
       arquivo_nome = EXCLUDED.arquivo_nome,
       armazenado_em = EXCLUDED.armazenado_em`,
      [
        normalizeBase64(fileBase64),
        senha,
        fileName,
        now,
      ],
    );

    await client.query(
      `INSERT INTO certificado
       (
         id,
         cnpj,
         cnpj_raiz,
         validade_inicio,
         validade_fim,
         emissor,
         serial,
         arquivo_nome,
         armazenado_em
       )
     VALUES
       (1, $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       cnpj = EXCLUDED.cnpj,
       cnpj_raiz = EXCLUDED.cnpj_raiz,
       validade_inicio = EXCLUDED.validade_inicio,
       validade_fim = EXCLUDED.validade_fim,
       emissor = EXCLUDED.emissor,
       serial = EXCLUDED.serial,
       arquivo_nome = EXCLUDED.arquivo_nome,
       armazenado_em = EXCLUDED.armazenado_em`,
      [
        certInfo.cnpj,
        certInfo.cnpj_raiz,
        certInfo.validade_inicio,
        certInfo.validade_fim,
        certInfo.emissor,
        certInfo.serial,
        fileName,
        now,
      ],
    );

    await client.query('COMMIT');

    return certInfo;
  } catch (error) {
    await client.query('ROLLBACK');

    throw error;
  } finally {
    client.release();
  }
}