import { DANFe } from 'node-sped-pdf';
import { saveFile } from './files.js';

export async function gerarDanfe(
  xmlContent: string,
  chaveAcesso: string,
  cnpjUnidade: string,
  dataEmissao: string | null,
): Promise<{ success: boolean; pdfPath: string }> {
  const result: any = await DANFe({ xml: xmlContent });

  let pdfBase64: string;

  if (typeof result === 'string') {
    pdfBase64 = result;
  } else if (result?.data || result?.base64 || result?.pdf) {
    pdfBase64 = result.data || result.base64 || result.pdf;
  } else if (Buffer.isBuffer(result)) {
    pdfBase64 = result.toString('base64');
  } else if (result instanceof Uint8Array) {
    pdfBase64 = Buffer.from(result).toString('base64');
  } else {
    const resultStr = String(result);
    if (resultStr.startsWith('data:application/pdf')) {
      pdfBase64 = resultStr.split(',')[1];
    } else if (resultStr.match(/^[A-Za-z0-9+/=]+$/)) {
      pdfBase64 = resultStr;
    } else {
      throw new Error('Formato de retorno da biblioteca DANFE não reconhecido');
    }
  }

  const emissao = dataEmissao ? new Date(dataEmissao) : new Date();
  const ano = emissao.getFullYear();
  const mes = String(emissao.getMonth() + 1).padStart(2, '0');
  const filePath = `${cnpjUnidade}/${ano}/${mes}/${chaveAcesso}.pdf`;

  const pdfBytes = Buffer.from(pdfBase64, 'base64');
  saveFile(filePath, pdfBytes);

  return { success: true, pdfPath: filePath };
}
