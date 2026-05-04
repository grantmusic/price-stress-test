import { createHash } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, '..', 'sample-images');
const XMLS_DIR   = path.join(__dirname, '..', 'sample-xmls');

let _imageCache = null;
let _xmlCache   = null;

async function getRandomImage() {
    if (!_imageCache) {
        const files = await readdir(IMAGES_DIR).catch(() => []);
        _imageCache = files.filter(f => /\.(jpg|jpeg|png|tif|tiff|pdf)$/i.test(f));
    }
    if (_imageCache.length === 0) throw new Error('No images found in sample-images/ — add at least one image file');
    const file = _imageCache[Math.floor(Math.random() * _imageCache.length)];
    const buf  = await readFile(path.join(IMAGES_DIR, file));
    return {
        file,
        base64: buf.toString('base64'),
        hash:   createHash('sha256').update(buf).digest('hex').toUpperCase(),
    };
}

async function getRandomXml() {
    if (!_xmlCache) {
        const files = await readdir(XMLS_DIR).catch(() => []);
        _xmlCache = files.filter(f => /\.xml$/i.test(f));
    }
    if (_xmlCache.length === 0) throw new Error('No XML files found in sample-xmls/ — add at least one URLA MISMO 3.4 file');
    const file = _xmlCache[Math.floor(Math.random() * _xmlCache.length)];
    const buf  = await readFile(path.join(XMLS_DIR, file));
    return { file, base64: buf.toString('base64') };
}

function today() {
    return new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

function splitNames(str) {
    return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

function randAmount(min = 50, max = 5000) {
    return (Math.random() * (max - min) + min).toFixed(2);
}

export function getEnabledTransactions(txConfig) {
    return Object.entries(txConfig)
        .filter(([, cfg]) => cfg.enabled)
        .map(([type, cfg]) => ({ type, ...cfg }));
}

export async function executeTransaction(client, tx, loanNumber) {
    switch (tx.type) {

        // ── GET calls ────────────────────────────────────────────────────────

        case 'get_loan':
            return client.get('get_loan', { LoanNumberID: loanNumber });

        case 'get_dates':
            return client.get('get_dates', { LoanNumberID: loanNumber });

        case 'get_deposit_accounts':
            return client.get('get_deposit_accounts', { LoanNumberID: loanNumber });

        case 'get_loan_fees':
            return client.get('get_loan_fees', { LoanNumberID: loanNumber });

        case 'get_incomes':
            return client.get('get_incomes', { LoanNumberID: loanNumber });

        case 'get_liabilities':
            return client.get('get_liabilities', { LoanNumberID: loanNumber });

        case 'get_customers':
            return client.get('get_customers', { LoanNumberID: loanNumber });

        case 'get_properties':
            return client.get('get_properties', { LoanNumberID: loanNumber });

        // ── SET calls ────────────────────────────────────────────────────────

        case 'add_or_update_date': {
            const names = splitNames(tx.dateNames);
            if (!names.length) throw new Error('add_or_update_date: no date names configured');
            for (const name of names) {
                await client.postForm('add_or_update_date',
                    { DateName: name, DateValue: today() },
                    { LoanNumberID: loanNumber }
                );
            }
            return;
        }

        case 'put_virtual_data': {
            const names = splitNames(tx.names);
            if (!names.length) throw new Error('put_virtual_data: no virtual data names configured');
            for (const name of names) {
                await client.postForm('put_virtual_data',
                    { VirtualDataName: name, VirtualDataValue: 'STRESS_TEST' },
                    { LoanNumberID: loanNumber }
                );
            }
            return;
        }

        case 'set_extra_data': {
            const names = splitNames(tx.names);
            if (!names.length) throw new Error('set_extra_data: no field names configured');
            for (const name of names) {
                await client.postForm('set_extra_data',
                    { FieldName: name, FieldValue: 'STRESS_TEST' },
                    { LoanNumberID: loanNumber }
                );
            }
            return;
        }

        case 'set_loan_fees':
            return client.postJson('set_loan_fees', {
                LoanFees: [{
                    LoanFeeID: 1,
                    Fields: [{ FieldName: 'Total', FieldValue: randAmount() }],
                }],
            }, { LoanNumberID: loanNumber });

        case 'set_loan_data':
            return client.postJson('set_loan_data', {
                LoanFields: [{ FieldName: 'Notes', FieldValue: `Stress test ${Date.now()}` }],
            }, { LoanNumberID: loanNumber });

        case 'set_loan_servicing_data':
            return client.postJson('set_loan_servicing_data', {
                LoanServicingFields: [{ FieldName: 'LoanServicing_Notes', FieldValue: `Stress test ${Date.now()}` }],
            }, { LoanNumberID: loanNumber });

        case 'add_conversation_log':
            return client.postForm('add_conversation_log', {}, {
                LoanNumberID:         loanNumber,
                ConversationType:     40,
                IsConversationPublic: 0,
                RelatedToMemoID:      0,
                Subject:              'Stress Test',
                Memo:                 `Automated stress test entry ${Date.now()}`,
            });

        case 'set_adjustment':
            return client.postJson('set_adjustment', {
                Adjustments: [{ FieldName: 'Gross_Revenue', FieldValue: randAmount(0, 10) }],
            }, { LoanNumberID: String(loanNumber) });

        case 'upload_image_file': {
            const { file, base64, hash } = await getRandomImage();
            return client.postImageFile('upload_image_file', base64, {
                LoanNumberID: loanNumber,
                StatusID:     -1,
                FileName:     file,
                B2BFlag:      0,
                Hash:         hash,
            });
        }

        case 'import_from_file': {
            const { base64 } = await getRandomXml();
            return client.postForm('import_from_file',
                { Base64FileData: base64 },
                { LoanNumber: 0, FileType: 6, DateName: 'Lead' }
            );
        }

        default:
            throw new Error(`Unknown transaction type: ${tx.type}`);
    }
}
