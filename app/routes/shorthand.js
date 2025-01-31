
let { route } = require('./cookies')
async function shorthand(shorthandObj, req, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, isShorthand, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken){
    const math = require('mathjs');
    let matrix = [];
    let colID = [];
    let rowID = [];
    let rowResult = [];
    let highestCol = 0;
    let resRow = 0
    let curRow = 0
    let shorthandArray = shorthandObj.input
    let skip = shorthandObj.skip
    let maxSweeps = shorthandObj.sweeps




    const comparisonOperators = {
        "==": (a, b) => a === b,
        "!=": (a, b) => a != b,
        ">": (a, b) => a > b,
        ">=": (a, b) => a >= b,
        "<": (a, b) => a < b,
        "<=": (a, b) => a <= b
    };
    function deepMerge(target, source) {
        if (source && typeof source === "object" && !Array.isArray(source)) {
            if (!target || typeof target !== "object" || Array.isArray(target)) {
                target = {};
            }
            const merged = { ...target };
            for (const key of Object.keys(source)) {
                merged[key] = deepMerge(target[key], source[key]);
            }
            return merged;
        } else if (Array.isArray(source)) {
            if (!Array.isArray(target)) {
                target = [];
            }
            const merged = [...target];
            for (let i = 0; i < source.length; i++) {
                merged[i] = deepMerge(target[i], source[i]);
            }
            return merged;
        } else {
            return source;
        }
    }
    var keywords = {
        ROUTE: async (rowArray) =>{


            let xAccessToken = req.body.headers["X-accessToken"]
            let originalHost = "https://abc.api.1var.com/cookies/"+"newGroup/r1/r1";
            let splitOriginalHost = originalHost.split("1var.com")[1];
            let reqPath = splitOriginalHost.split("?")[0];
            let reqBody = req.body;
            const action = reqPath.split("/")[2];



            let newReq = {};
            newReq.body = req.body
            newReq.body.headers["X-Original-Host"] = "https://abc.api.1var.com/cookies/"+"newGroup/r1/r1"
            newReq.method = req.method
            newReq.type = req.type
            newReq._headerSent = req._headerSent
            newReq.path = req.path
            let resp = await route(newReq, res, next, privateKey, dynamodb, uuidv4, s3, ses, openai, Anthropic, dynamodbLL, true, reqPath, reqBody, reqMethod, reqType, reqHeaderSent, signer, action, xAccessToken);
            console.log("resp=>", resp);
            return ""
        },
        EMPTY: (rowArray) => {
            return ""
        },
        JOIN: (rowArray) => {
            const updatedArray = rowArray.map(str =>
                typeof str === "string" ? str.replace(/¡¡/g, "!!") : str
            );
            const resolved = resolveRow(updatedArray);
            const flattenDeep = (arr) => {
                return arr.reduce((acc, item) => {
                    if (Array.isArray(item)) {
                        acc.push(...flattenDeep(item)); 
                    } else if (item && typeof item === "object" && Array.isArray(item.__useArray)) {
                        acc.push(...flattenDeep(item.__useArray)); 
                    } else {
                        acc.push(item);
                    }
                    return acc;
                }, []);
            };
            const items = resolved.slice(1);
            const flattened = flattenDeep(items);
            return flattened.join("");
        },
        SUBSTITUTE: (rowArray) => {
            const str = resolveCell(rowArray[1]);
            const search = resolveCell(rowArray[2]);
            const replacement = resolveCell(rowArray[3]);
            const nth = resolveCell(rowArray[4]);
            let occurrences = 0;
            return str.replace(new RegExp(search, "g"), (match) => {
                if (!nth || nth === "") {
                    return replacement;
                }
                if (occurrences.toString() === nth) {
                    occurrences++;
                    return replacement;
                }
                occurrences++;
                return match;
            });
        },
        RANGE: (rowArray) => {
            const fromRef = rowArray[1];
            const toRef = rowArray[2];
            const fromCell = getCellID(fromRef);
            const toCell = getCellID(toRef);
            if (!fromCell || !toCell) return [];
            const rowIndex = fromCell.row;
            const startCol = Math.min(fromCell.col, toCell.col);
            const endCol = Math.max(fromCell.col, toCell.col);
            let results = [];
            for (let col = startCol; col <= endCol; col++) {
                let rawCellTxt = matrix[rowIndex][col];
                let resolved = resolveCell(rawCellTxt);
                results.push(resolved);
            }
            return results;
        },
        USE: (rowArray) => {
            const argRef = rowArray[1];
            const resolvedVal = resolveCell(argRef);
            return { __useArray: resolvedVal };
        },
        AVG: (rowArray) => {
            const values = rowArray.slice(1).map((cell) => {
                const resolvedValue = resolveCell(cell);
                return isNaN(resolvedValue) ? 0 : parseFloat(resolvedValue);
            });
            const sum = values.reduce((acc, val) => acc + val, 0);
            const average = values.length > 0 ? sum / values.length : 0;
            return average.toFixed(2);
        },
        SUM: (rowArray) => {
            const values = rowArray.slice(1).map((cell) => {
                const resolvedValue = resolveCell(cell);
                return isNaN(resolvedValue) ? 0 : parseFloat(resolvedValue);
            });
            const sum = values.reduce((acc, val) => acc + val, 0);
            return sum.toFixed(2);
        },
        MED: (rowArray) => {
            const values = rowArray
                .slice(1)
                .map((cell) => {
                    const resolvedValue = resolveCell(cell);
                    return isNaN(resolvedValue) ? null : parseFloat(resolvedValue);
                })
                .filter((val) => val !== null);
            values.sort((a, b) => a - b);
            const len = values.length;
            if (len === 0) return "0.00";
            const mid = Math.floor(len / 2);
            if (len % 2 !== 0) {
                return values[mid].toFixed(2);
            }
            const median = (values[mid - 1] + values[mid]) / 2;
            return median.toFixed(2);
        },
        CONDITION: (rowArray) => {
            const leftVal = resolveCell(rowArray[1]);
            const operator = resolveCell(rowArray[2]);
            const rightVal = resolveCell(rowArray[3]);
            const leftNum = parseFloat(leftVal);
            const rightNum = parseFloat(rightVal);
            if (!comparisonOperators[operator]) {
                return false;
            }
            if (!isNaN(leftNum) && !isNaN(rightNum)) {
                return comparisonOperators[operator](leftNum, rightNum);
            }
            if (operator === "==") {
                return leftVal === rightVal;
            } else if (operator === "!=") {
                return leftVal != rightVal;
            } else {
                return false;
            }
        },
        ITE: (rowArray) => {
            const conditionVal = resolveCell(rowArray[1]);
            const thenVal = resolveCell(rowArray[2]);
            const elseVal = resolveCell(rowArray[3]);
            let isTrue;
            if (typeof conditionVal === "boolean") {
                isTrue = conditionVal;
            }
            else if (typeof conditionVal === "string") {
                const lower = conditionVal.toLowerCase();
                if (lower === "true") {
                    isTrue = true;
                } else if (lower === "false" || lower === "") {
                    isTrue = false;
                } else {
                    isTrue = true;
                }
            }
            else {
                isTrue = Boolean(conditionVal);
            }
            return isTrue ? thenVal : elseVal;
        },
        ALL: (rowArray) => {
            const values = rowArray.slice(1).map((cell) => resolveCell(cell));
            const bools = values.map((val) => {
                if (typeof val === "boolean") return val;
                if (typeof val === "string") {
                    const lower = val.toLowerCase();
                    if (lower === "true") return true;
                    if (lower === "false" || lower === "") return false;
                }
                return Boolean(val);
            });
            return bools.every((b) => b === true);
        },
        JSON: (rowArray) => {
            let jsonStr = resolveCell(rowArray[1]);
            if (typeof jsonStr !== "string") {
                return jsonStr;
            }
            try {
                return JSON.parse(jsonStr);
            } catch (e) {
                console.error("Invalid JSON string:", jsonStr, e);
                return {};
            }
        },
        ARRAY: (rowArray) => {
            try {
                let arrStr = resolveCell(rowArray[1]);
                if (typeof arrStr === "string" && rowArray.length === 2) {
                    let parsed = JSON.parse(arrStr);
                    if (Array.isArray(parsed)) {
                        return parsed;
                    }
                }
                const resolvedArray = [];
                for (let i = 1; i < rowArray.length; i++) {
                    const cellValue = resolveCell(rowArray[i]);
                    resolvedArray.push(cellValue);
                }
                return resolvedArray;
            } catch (e) {
                console.error("ARRAY: Error processing rowArray:", rowArray, e);
                return [];
            }
        },
        APPEND: (rowArray) => {
            try {
                const baseRef = resolveCell(rowArray[1]);
                let copyArr = Array.isArray(baseRef) ? [...baseRef] : [];
                const resolvedElements = [];
                for (let i = 2; i < rowArray.length; i++) {
                    const cellValue = resolveCell(rowArray[i]);
                    resolvedElements.push(cellValue);
                }
                copyArr.push(...resolvedElements);
                return copyArr;
            } catch (e) {
                console.error("APPEND: Error processing rowArray:", rowArray, e);
                return [];
            }
        },
        PREPEND: (rowArray) => {
            try {
                const baseRef = resolveCell(rowArray[1]);
                let copyArr = Array.isArray(baseRef) ? [...baseRef] : [];
                const resolvedElements = [];
                for (let i = 2; i < rowArray.length; i++) {
                    const cellValue = resolveCell(rowArray[i]);
                    resolvedElements.push(cellValue);
                }
                copyArr.unshift(...resolvedElements);
                return copyArr;
            } catch (e) {
                console.error("PREPEND: Error processing rowArray:", rowArray, e);
                return [];
            }
        },
        ADDPROPERTY: (rowArray) => {
            let baseRef = rowArray[1];
            let key = resolveCell(rowArray[2]);
            let valueRef = rowArray[3];
            if (isRowResultRef(baseRef) || isJSON(baseRef)) {
                let baseObj
                if (isRowResultRef(baseRef)) {
                    let baseIndex = parseInt(baseRef.slice(0, 3), 10);
                    baseObj = rowResult[baseIndex];
                } else {
                    baseObj = baseRef
                }
                if (typeof baseObj !== "object" || baseObj === null) {
                    baseObj = {};
                } else {
                    baseObj = Array.isArray(baseObj) ? [...baseObj] : { ...baseObj };
                }
                let finalVal;
                if (isRowResultRef(valueRef)) {
                    let valIndex = parseInt(valueRef.slice(0, 3), 10);
                    finalVal = rowResult[valIndex];
                } else {
                    finalVal = resolveCell(valueRef);
                }
                baseObj[key] = finalVal;
                return baseObj;
            } else {
                console.error("ADDPROPERTY: The base reference is not a rowResult reference:", baseRef);
                return {};
            }
        },
        MERGE: (rowArray) => {
            let baseRef = rowArray[1];
            if (isRowResultRef(baseRef)) {
                const baseIndex = parseInt(baseRef.slice(0, 3), 10);
                baseRef = rowResult[baseIndex];
            } else if (typeof baseRef === "string") {
                try {
                    baseRef = JSON.parse(baseRef);
                } catch (e) {
                    console.warn("MERGE: baseRef is a string that did not parse as JSON. Using plain text:", baseRef);
                }
            }
            if (Array.isArray(baseRef)) {
                return baseRef.reduce((acc, item) => {
                    let parsedItem = typeof item === "string" ? safelyParseJSON(item) : item;
                    return deepMerge(acc, parsedItem);
                }, {});
            } else if (typeof baseRef === "object" && baseRef !== null) {
                const newDataRef = rowArray[2];
                let newData = resolveCell(newDataRef);
                if (typeof newData === "string") {
                    try {
                        newData = JSON.parse(newData);
                    } catch (e) {
                        console.warn("MERGE: newData is a string that did not parse as JSON. Using plain text:", newData);
                    }
                }
                return deepMerge(baseRef, newData);
            } else {
                // If we get here, baseRef is neither an array nor an object
                console.error("MERGE: rowArray[1] must be either an array or object:", baseRef);
                return {};
            }
        },
        NESTED: (rowArray) => {
            const baseRef = rowArray[1];
            if (!isRowResultRef(baseRef) && !isJSON(baseRef)) {
                console.error("NESTED: The base reference is not a rowResult reference:", baseRef);
                return {};
            }
            let baseObj
            if (isRowResultRef(baseRef)) {
                let baseIndex = parseInt(baseRef.slice(0, 3), 10);
                baseObj = rowResult[baseIndex];
            } else {
                baseObj = baseRef
            }
            if (typeof baseObj !== "object" || baseObj === null) {
                return setNestedValue({}, rowArray.slice(2, -1), resolveCell(rowArray[rowArray.length - 1]));
            }
            let newObj = Array.isArray(baseObj)
                ? [...baseObj]
                : { ...baseObj };
            const pathTokens = rowArray.slice(2, rowArray.length - 1);
            const valueRef = rowArray[rowArray.length - 1];
            let finalVal;
            if (isRowResultRef(valueRef)) {
                let valIndex = parseInt(valueRef.slice(0, 3), 10);
                finalVal = rowResult[valIndex];
            } else {
                finalVal = resolveCell(valueRef);
            }
            const updatedObj = setNestedValue(newObj, pathTokens, finalVal);
            return updatedObj;
        },
        GET: (rowArray) => {
            const baseRef = rowArray[1];
            if (!isRowResultRef(baseRef) && !isJSON(baseRef)) {
                console.error("NESTED: The base reference is not a rowResult reference:", baseRef);
                return {};
            }
            const pathTokens = rowArray.slice(2, rowArray.length);
            let nested = getNested(baseRef, pathTokens)
            return nested;
        },
        DELETEPROPERTY: (rowArray) => {
            const baseRef = rowArray[1];
            if (!isRowResultRef(baseRef) && !isJSON(baseRef)) {
                console.error("DELETEPROPERTY: The base reference is not a rowResult reference:", baseRef);
                return {};
            }
            let baseObj;
            if (isRowResultRef(baseRef)) {
                let baseIndex = parseInt(baseRef.slice(0, 3), 10);
                baseObj = rowResult[baseIndex];
            } else {
                baseObj = baseRef;
            }
            if (typeof baseObj !== "object" || baseObj === null) {
                return {};
            }
            let newObj = Array.isArray(baseObj)
                ? [...baseObj]
                : { ...baseObj };
            const pathTokens = rowArray.slice(2);
            deleteNestedValue(newObj, pathTokens);
            return newObj;
        },
        STRING: (rowArray) => {
            let val
            if (isJSON(rowArray[1])) {
                val = JSON.stringify(rowArray[1], null, 2);
            } else {
                val = String(resolveCell(rowArray[1]));
            }
            return val;
        },
        INTEGER: (rowArray) => {
            let val = resolveCell(rowArray[1]);
            let intVal = parseInt(val, 10);
            if (isNaN(intVal)) {
                return 0;
            }
            return intVal;
        },
        FLOAT: (rowArray) => {
            let val = resolveCell(rowArray[1]);
            let floatVal = parseFloat(val);
            if (isNaN(floatVal)) {
                return 0.0;
            }
            return floatVal;
        },
        BUFFER: (rowArray) => {
            let val = resolveCell(rowArray[1]);
            if (typeof val !== "string") {
                return Buffer.from([]);
            }
            try {
                return Buffer.from(val, "base64");
            } catch (e) {
                return Buffer.from([]);
            }
        },
        ROWRESULT: (rowArray) => {
            rowResult[parseInt(rowArray[1], 10)] = resolveCell(rowArray[2]);
            //return rowResult[ parseInt(rowArray[1], 10) ]
        },
        LOOP: (rowArray) => {
            if (!rowResult[resRow]) {
                rowResult[resRow] = [0]
            }
    
            rowResult[resRow][0] = rowResult[resRow][0] + 1
            let res = rowResult[resRow][0]
            return res
        },
        ADD: (rowArray) => {
            let total = 0;
            for (let i = 1; i < rowArray.length; i++) {
                const expr = resolveCell(rowArray[i]);
                let val;
                try {
                    val = math.evaluate(expr.toString());
                } catch (e) {
                    console.error(`ADD: Error evaluating expression "${expr}":`, e);
                    val = 0;
                }
                if (isNaN(val)) val = 0;
                total += val;
            }
            return total;
        },
        SUBTRACT: (rowArray) => {
            if (rowArray.length < 2) return 0;
            let initial = 0;
            try {
                initial = math.evaluate(resolveCell(rowArray[1]).toString());
            } catch (e) {
                console.error(`SUBTRACT: Error evaluating expression "${rowArray[1]}":`, e);
                initial = 0;
            }
            for (let i = 2; i < rowArray.length; i++) {
                let val;
                const expr = resolveCell(rowArray[i]);
                try {
                    val = math.evaluate(expr.toString());
                } catch (e) {
                    console.error(`SUBTRACT: Error evaluating expression "${expr}":`, e);
                    val = 0;
                }
                if (isNaN(val)) val = 0;
                initial -= val;
            }
            return initial;
        },
        RUN: (rowArray) => {
            return parseInt(rowArray[1], 10);
        },
        MATRIX: (rowArray) => {
            let row = getCellID(rowArray[1].toUpperCase()).row;
            let col = getCellID(rowArray[1].toUpperCase()).col;
            matrix[row][col] = rowArray[2];
        },
        UPPER: (rowArray) => {
            const str = resolveCell(rowArray[1]);
            if (typeof str !== "string") {
                return "";
            }
            return str.toUpperCase();
        },
        LOWER: (rowArray) => {
            const str = resolveCell(rowArray[1]);
            if (typeof str !== "string") {
                return "";
            }
            return str.toLowerCase();
        },
        FIND: (rowArray) => {
            const needle = resolveCell(rowArray[1]);
            if (typeof needle !== "string") {
                return "";
            }
            for (let r = 0; r < matrix.length; r++) {
                for (let c = 0; c < matrix[r].length; c++) {
                    if (matrix[r][c] === needle) {
                        return rowID[r] + colID[c];
                    }
                }
            }
            return "";
        }
    };
    function safelyParseJSON(str) {
        try {
            return JSON.parse(str);
        } catch (e) {
            console.warn("Failed to parse JSON. Returning string as-is.");
            return str;
        }
    }
    
    function getNested(obj, path) {
        let current = obj;
        for (const segment of path) {
            if (current == null || !(segment in current)) {
                return undefined;
            }
            current = current[segment];
        }
        return current;
    }
    function isJSON(value) {
        try {
            if (typeof value == "string") {
                JSON.parse(value);
                return true;
            } else if (typeof value == "object") {
                return true
            } else {
                return false
            }
        } catch (e) {
            return false;
        }
    }
    function parsePathToken(token) {
        try {
            const match = token.match(/^\[(\d+)\]$/);
            if (match) {
                return parseInt(match[1], 10);
            }
        } catch { }
        return token;
    }
    function deleteNestedValue(obj, pathTokens) {
        if (!pathTokens || pathTokens.length === 0) return obj;
        const lastToken = parsePathToken(pathTokens[pathTokens.length - 1]);
        let current = obj;
        for (let i = 0; i < pathTokens.length - 1; i++) {
            const token = parsePathToken(pathTokens[i]);
            if (typeof token === "number") {
                if (!Array.isArray(current[token])) {
                    return obj;
                }
                current[token] = [...current[token]];
                current = current[token];
            } else {
                if (typeof current[token] !== "object" || current[token] === null) {
                    return obj;
                }
                current[token] = Array.isArray(current[token])
                    ? [...current[token]]
                    : { ...current[token] };
                current = current[token];
            }
        }
        if (typeof lastToken === "number") {
            if (Array.isArray(current) && lastToken < current.length) {
                current.splice(lastToken, 1);
            }
        } else {
            if (typeof current === "object" && current !== null) {
                delete current[lastToken];
            }
        }
        return obj;
    }
    function setNestedValue(obj, pathTokens, newValue) {
        let current = obj;
        for (let i = 0; i < pathTokens.length; i++) {
            const isLast = i === pathTokens.length - 1;
            const token = parsePathToken(pathTokens[i]);
            if (!isLast) {
                if (typeof token === "number") {
                    if (!Array.isArray(current)) {
                        current = [];
                    }
                    if (!current[token] || typeof current[token] !== "object") {
                        current[token] = {};
                    }
                    current = current[token];
                } else {
                    if (typeof current[token] !== "object" || current[token] === null) {
                        current[token] = {};
                    }
                    current = current[token];
                }
            } else {
                if (typeof token === "number") {
                    if (!Array.isArray(current)) {
                        current = [];
                    }
                    current[token] = newValue;
                } else {
                    current[token] = newValue;
                }
            }
        }
        return obj;
    }
    function isRowResultRef(txt) {
        return /^\d{3}!!$/.test(txt);
    }
    function isFullRowRef(txt) {
        return /^\d{3}~~$/.test(txt);
    }
    function isCellRef(txt) {
        return /^\d{3}[A-Z]{2}$/.test(txt);
    }
    function isCellRefString(txt) {
        return /^\d{3}[a-z]{2}$/.test(txt);
    }
    function getRow(cellTxt) {
        if (getCellID(cellTxt)) {
            return cellTxt.slice(0, 3);
        } else {
            return undefined;
        }
    }
    function resolveRow(row) {
        let arr = [];
        for (let x = 0; x < row.length; x++) {
            let el = resolveCell(row[x]);
            arr.push(el);
        }
        return arr;
    }
    function getColumnLabel(index) {
        let label = "";
        while (index >= 0) {
            label = String.fromCharCode((index % 26) + 65) + label;
            index = Math.floor(index / 26) - 1;
        }
        return label;
    }
    function resolveCell(cellTxt) {
        if (isRowResultRef(cellTxt)) {
            let rowIndex = parseInt(cellTxt.slice(0, 3), 10);
            return rowResult[rowIndex] !== undefined ? rowResult[rowIndex] : "Undefined Reference";
        }
        if (isFullRowRef(cellTxt)) {
            let rowIndex = parseInt(cellTxt.slice(0, 3), 10);
            let rowData = matrix[rowIndex];
            if (Array.isArray(rowData) && rowData.length > 0 && rowData[0] in keywords) {
                let parsed = parseNestedKeywords(rowData);
                if (parsed.type === "MULTIPLE_FUNCTIONS") {
                    const allResults = parsed.list.map(fn => fn.RESULTS);
                    return allResults;
                }
                else if (parsed && parsed.RESULTS !== undefined) {
                    return parsed.RESULTS;
                }
                else {
                    return rowData;
                }
            } else {
                return rowData;
            }
        }
        let cell = getCellID(cellTxt);
        if (cell) {
            let ref = matrix[cell.row][cell.col];
            if (getCellID(ref) || isRowResultRef(ref) || isFullRowRef(ref)) {
                return resolveCell(ref);
            } else {
                return ref;
            }
        } else {
            return cellTxt;
        }
    }
    function getCellID(txt) {
        const rowPart = txt.toString().slice(0, 3);
        const colPart = txt.toString().slice(3);
        if (!isNaN(rowPart) && colID.includes(colPart)) {
            const rowIndex = parseInt(rowPart, 10);
            const colIndex = colID.indexOf(colPart);
            return { row: rowIndex, col: colIndex };
        } else {
            return null;
        }
    }
    function generateColIDs() {
        colID = [];
        let label = "";
        for (let index = 0; index <= highestCol; index++) {
            let num = index + 26;
            label = "";
            do {
                label = String.fromCharCode(65 + (num % 26)) + label;
                num = Math.floor(num / 26) - 1;
            } while (num >= 0);
            colID.push(label);
        }
    }
    function generateRowID() {
        let newID = rowID.length.toString().padStart(3, "0");
        rowID.push(newID);
        return newID;
    }
    async function addRow(n, position, rowData) {
        if (Array.isArray(n)) {
            rowData = n;
            n = undefined;
            position = undefined;
        }
        let newRow = Array.isArray(rowData) ? [...rowData] : [];
        if (n === undefined) {
            matrix.push(newRow);
            generateRowID();
            if (newRow.length - 1 > highestCol) {
                highestCol = newRow.length - 1;
                generateColIDs();
            }
        } else if (Number.isInteger(n)) {
            let insertIndex;
            if (position === "above") {
                insertIndex = n - 1;
            } else if (position === "below") {
                insertIndex = n;
            } else {
                insertIndex = n - 1;
            }
            if (insertIndex < 0) insertIndex = 0;
            matrix.splice(insertIndex, 0, newRow);
            rowID.splice(insertIndex, 0, generateRowID());
            if (newRow.length - 1 > highestCol) {
                highestCol = newRow.length - 1;
                generateColIDs();
            }
        } else {
            console.error("Invalid arguments passed to addRow.");
        }
    }
    async function displayTable() {
        for (let row = 0; row < matrix.length; row++) {
            let rowLog = "RowID: " + rowID[row] + " [";
            for (let col = 0; col < matrix[row].length; col++) {
                if (col == 0) {
                    rowLog += '"' + matrix[row][col] + '"';
                } else {
                    rowLog += ', "' + matrix[row][col] + '"';
                }
            }
            rowLog += ']';
            console.log(rowLog);
        }
    }
    async function parseFunction(row, startIndex) {
        const functionName = resolveCell(row[startIndex]);
        if (functionName === "ITE") {
            let i = startIndex + 1;
            let conditionVal;
            if (row[i] in keywords) {
                const conditionParsed = parseFunction(row, i);
                i = conditionParsed.newIndex;
                conditionVal = conditionParsed.nestedObj.RESULTS;
            } else {
                conditionVal = resolveCell(row[i]);
                i++;
            }
            let isTrue;
            if (typeof conditionVal === "boolean") {
                isTrue = conditionVal;
            } else if (typeof conditionVal === "string") {
                const lower = conditionVal.toLowerCase();
                if (lower === "true") {
                    isTrue = true;
                } else if (lower === "false" || lower === "") {
                    isTrue = false;
                } else {
                    isTrue = true;
                }
            } else {
                isTrue = Boolean(conditionVal);
            }
            let thenScripts = [];
            while (
                i < row.length &&
                row[i] !== "*****" &&   
                row[i] !== "-----" &&
                row[i] !== "#####"
            ) {
                if (row[i] in keywords) {
                    const parsedThen = parseFunction(row, i);
                    thenScripts.push(parsedThen.nestedObj.RESULTS);
                    i = parsedThen.newIndex;
                } else {
                    thenScripts.push(resolveCell(row[i]));
                    i++;
                }
            }
            if (row[i] === "*****") {
                i++;
            }
            let elseScripts = [];
            if (!isTrue) {
                while (
                    i < row.length &&
                    row[i] !== "-----" &&
                    row[i] !== "*****" &&
                    row[i] !== "#####"
                ) {
                    if (row[i] in keywords) {
                        const parsedElse = parseFunction(row, i);
                        elseScripts.push(parsedElse.nestedObj.RESULTS);
                        i = parsedElse.newIndex;
                    } else {
                        elseScripts.push(resolveCell(row[i]));
                        i++;
                    }
                }
                if (row[i] === "*****") {
                    i++;
                }
            } else {
                while (
                    i < row.length &&
                    row[i] !== "-----" &&
                    row[i] !== "#####" &&
                    row[i] !== undefined
                ) {
                    if (row[i] === "*****") {
                        i++;
                        break;
                    }
                    i++;
                }
            }
            if (row[i] === "-----" || row[i] === "*****" || row[i] === "#####") {
                i++;
            }
            const finalResult = isTrue ? thenScripts : elseScripts;
            return {
                nestedObj: {
                    AA: "ITE", 
                    RESULTS: finalResult
                },
                newIndex: i
            };
        }
        else if (functionName === "RUN") {
            const ref = resolveCell(row[startIndex + 1]);
            let rowNumbers = [];
            if (Array.isArray(ref)) {
                rowNumbers = ref.map(num => parseInt(num, 10));
            } else {
                rowNumbers = [parseInt(ref, 10)];
            }
            const fnObj = {
                AA: "RUN",
                AB: rowNumbers, 
                RESULTS: null
            };
            let i = startIndex + 2;
            while (
                i < row.length &&
                row[i] !== "-----" &&
                row[i] !== "*****" &&
                row[i] !== "#####"
            ) {
                i++;
            }
            if (row[i] === "-----" || row[i] === "*****" || row[i] === "#####") {
                i++;
            }
            return {
                nestedObj: fnObj,
                newIndex: i
            };
        } else {
            let funcObj = {};
            funcObj["AA"] = functionName; 
            let argIndex = 0;
            let i = startIndex + 1;
            while (
                i < row.length &&
                row[i] !== "-----" &&
                row[i] !== "*****" &&
                row[i] !== "#####"
            ) {
                const maybeFnName = resolveCell(row[i]);
                if (maybeFnName in keywords) {
                    const nestedParse = parseFunction(row, i);
                    argIndex++;
                    const argKey = getColumnLabel(argIndex); 
                    funcObj[argKey] = nestedParse.nestedObj; 
                    i = nestedParse.newIndex;
                } else {
                    argIndex++;
                    const argKey = getColumnLabel(argIndex);
                    funcObj[argKey] = isCellRefString(row[i]) ? row[i].toUpperCase() : resolveCell(row[i]);
                    i++;
                }
            }
            if (row[i] === "-----" || row[i] === "*****" || row[i] === "#####") {
                i++;
            }
            let functionArray = [functionName];
            const argKeys = Object.keys(funcObj).sort();
            for (let k of argKeys) {
                if (k === "AA" || k === "RESULTS") continue;
                const val = funcObj[k];
                if (val && typeof val === "object" && val.RESULTS !== undefined) {
                    functionArray.push(val.RESULTS);
                } else {
                    functionArray.push(val);
                }
            }
            let expanded = [];
            for (let item of functionArray) {
                if (item && typeof item === "object" && Array.isArray(item.__useArray)) {
                    expanded.push(...item.__useArray);
                } else {
                    expanded.push(item);
                }
            }
            functionArray = expanded;
            let result;
            try {
                result = await keywords[functionName](functionArray);
            } catch (err) {
                console.error("Error executing function:", functionName, err);
                result = "";
            }
            funcObj["RESULTS"] = result;
            return {
                nestedObj: funcObj,
                newIndex: i
            };
        }
    }
    function parseNestedKeywords(rowArray) {
        let i = 0;
        let topLevelFunctions = [];
        while (i < rowArray.length) {
            const token = rowArray[i];
            const resolved = resolveCell(token);
            if (resolved in keywords && rowArray[0] != "") {
                const parsed = parseFunction(rowArray, i);
                topLevelFunctions.push(parsed.nestedObj);
                i = parsed.newIndex;
                while (rowArray[i] === "-----" || rowArray[i] === "*****" || rowArray[i] === "#####") {
                    i++;
                }
            }
            else {
                topLevelFunctions.push("rowArray");
                i++;
            }
        }
        if (topLevelFunctions.length > 1) {
            if (topLevelFunctions[0].AA in keywords) {
                return {
                    type: "MULTIPLE_FUNCTIONS",
                    list: topLevelFunctions
                }
            } else {
                return topLevelFunctions[0]
            }
        }
        else {
            return topLevelFunctions[0];
        }
    }
    function parseRow(rowIndex) {
        const rowArray = matrix[rowIndex] || [];
        if (!Array.isArray(rowArray) || rowArray.length === 0) {
            rowResult[rowIndex] = "";
            return "";
        }
        // --- Use your existing nested parsing logic ---
        const parsed = parseNestedKeywords(rowArray);
        let topLevelFns = [];
        if (parsed && parsed.type === "MULTIPLE_FUNCTIONS") {
            topLevelFns = parsed.list;
        } else if (parsed) {
            topLevelFns = [parsed];
        }
        let finalResults = [];
        for (let fnObj of topLevelFns) {
            if (!fnObj || !fnObj.AA) {
                finalResults.push(null);
                continue;
            }
            if (fnObj.AA === "RUN") {
                const subRows = fnObj.AB;
                for (const subRow of subRows) {
                    parseRow(subRow);
                }
                finalResults.push(fnObj.RESULTS);
            } else {
                finalResults.push(fnObj.RESULTS);
            }
        }
        rowResult[rowIndex] = (finalResults.length === 1 ? finalResults[0] : finalResults);

        if (
            rowResult[rowIndex] == null ||
            (typeof rowArray[0] === "string" && (rowArray[0].includes("!!") || rowArray[0].includes("<<")))
        ) {
            rowResult[rowIndex] = resolveCell(rowArray[0]) || null;
        }
        return rowResult[rowIndex];
    }
    async function run(skipArray) {
        rowResult = [];
        resRow = 0;
        sweep = 0;
        function checkLoopSkip(r) {
            if (matrix[r] && matrix[r][0] === "LOOP") {
                let currentVal = 0;
                if (Array.isArray(rowResult[r])) {
                    currentVal = parseInt(rowResult[r][0], 10) || 0;
                } else if (!isNaN(rowResult[r])) {
                    currentVal = parseInt(rowResult[r], 10);
                }
                let loopLimit = parseInt(matrix[r][1], 10) || 0;
                if (currentVal < loopLimit) {
                    return true;
                } else {
                    if (Array.isArray(rowResult[r])) {
                        rowResult[r][0] = 0;
                    } else {
                        rowResult[r] = [0];
                    }
                }
            }
            return false;
        }
        while (resRow < matrix.length) {
            if (!skipArray.includes(resRow)) {
                parseRow(resRow);
            }
            const skipBump = checkLoopSkip(resRow);
            if (!skipBump) {
                resRow++;
            }
            if (resRow >= matrix.length && sweep < maxSweeps - 1) {
                resRow = 0;
                sweep++;
            }
        }
    }
    async function processArray(arr) {
        for (let i = 0; i < arr.length; i++) {
            const rowData = arr[i];
            if (!Array.isArray(rowData)) {
                let rowArray = rowData.match(/.{1,5}/g);
                await addRow(rowArray);
                continue;
            }
            if (/^\d{3}<<$/.test(rowData[0])) {
                const rowIndex = parseInt(rowData[0].slice(0, 3), 10);
                const newValues = rowData.slice(1).map((val) => {
                    if (isCellRefString(val)) {
                        return val.toUpperCase();
                    }
                    return val;
                });
                if (!matrix[rowIndex]) {
                    matrix[rowIndex] = [];
                    if (!rowID[rowIndex]) {
                        rowID[rowIndex] = rowIndex.toString().padStart(3, "0");
                    }
                }
                const existingRow = matrix[rowIndex];
                for (let j = 0; j < newValues.length; j++) {
                    existingRow[j] = newValues[j];
                }
                matrix[rowIndex] = existingRow;
                if (existingRow.length - 1 > highestCol) {
                    highestCol = existingRow.length - 1;
                    generateColIDs();
                }
                skip.push(resRow);
                await addRow(rowData);
            } else if (/^\d{3}>>$/.test(rowData[0])) {
                const rowIndex = parseInt(rowData[0].slice(0, 3), 10);
                const newValues = rowData.slice(1).map((val) => {
                    if (isCellRefString(val)) {
                        return val.toUpperCase();
                    }
                    return val;
                });
                if (!matrix[rowIndex]) {
                    matrix[rowIndex] = [];
                    if (!rowID[rowIndex]) {
                        rowID[rowIndex] = rowIndex.toString().padStart(3, "0");
                    }
                }
                matrix[rowIndex] = newValues;
                if (newValues.length - 1 > highestCol) {
                    highestCol = newValues.length - 1;
                    generateColIDs();
                }
                skip.push(resRow)
                await addRow(rowData);
            }
            else {
                await addRow(rowData);
            }
        }
        await run(skip);
        return rowResult[0]
    }
    console.log("shorthandArray",shorthandArray)
    let rr0 = await processArray(shorthandArray)
    return rr0
}


module.exports = {
    shorthand
};