async function shorthand(shorthandArray){
    var matrix = [];
    var colID = [];
    var rowID = [];
    var rowResult = [];
    var highestCol = 0;
    var resRow = 0
    var curRow = 0
    
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
        JOIN: (rowArray) => {
            return resolveRow(rowArray).slice(1).join("");
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
            const toRef   = rowArray[2];
            const fromCell = getCellID(fromRef);
            const toCell   = getCellID(toRef);
            if (!fromCell || !toCell) return [];
            const rowIndex = fromCell.row;
            const startCol = Math.min(fromCell.col, toCell.col);
            const endCol   = Math.max(fromCell.col, toCell.col);
    
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
          const thenVal      = resolveCell(rowArray[2]);
          const elseVal      = resolveCell(rowArray[3]);
    
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
                if (isRowResultRef(baseRef)){
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
            if (!isRowResultRef(baseRef) && !isJSON(baseRef)) {
                console.error("MERGE: The base reference is not a rowResult reference:", baseRef);
                return {};
            }
    
            let baseObj
            if (isRowResultRef(baseRef)){
                let baseIndex = parseInt(baseRef.slice(0, 3), 10);
                baseObj = rowResult[baseIndex];
            } else {
                baseObj = baseRef
            }
    
            for (let i = 2; i < rowArray.length; i++) {
                let newDataRef = rowArray[i];
                let newData = resolveCell(newDataRef);
    
                if (typeof newData === "string") {
                    try {
                        newData = JSON.parse(newData);
                    } catch (e) {
                        console.warn("MERGE: newData is a string that did not parse as JSON. Using it as plain text:", newData);
                    }
                }
    
                baseObj = deepMerge(baseObj, newData);
            }
    
            return baseObj;
        },
        NESTED: (rowArray) => {
            const baseRef = rowArray[1];
            if (!isRowResultRef(baseRef)  && !isJSON(baseRef)) {
              console.error("NESTED: The base reference is not a rowResult reference:", baseRef);
              return {};
            }
            
            let baseObj
            if (isRowResultRef(baseRef)){
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
        DELETEPROPERTY: (rowArray) => {
            const baseRef = rowArray[1];
            if (!isRowResultRef(baseRef)  && !isJSON(baseRef)) {
              console.error("DELETEPROPERTY: The base reference is not a rowResult reference:", baseRef);
              return {};
            }
            let baseObj;
            if (isRowResultRef(baseRef)){
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
            let val = resolveCell(rowArray[1]);
            return String(val);
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
            if (rowResult[resRow] == true){
                rowResult[parseInt(rowArray[1])] = resolveCell(rowArray[2])
                rowResult[resRow] = false
                resRow = 0
            } else {
                rowResult[parseInt(rowArray[1])] = resolveCell(rowArray[2])
                rowResult[parseInt(resRow)] = true
            }
        }
    };
    
    function isJSON(value) {
        try {
            if (typeof value == "string"){
                JSON.parse(value);
                return true;
            } else if (typeof value == "object"){
                return true
            } else {
                return false
            }
        } catch (e) {
            return false;
        }
    }
    
    function parsePathToken(token) {
        const match = token.match(/^\[(\d+)\]$/);
        if (match) {
            return parseInt(match[1], 10);
        }
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
                    if (!Array.isArray(current[token])) {
                        current[token] = [];
                    } else {
                        current[token] = [...current[token]];
                    }
                    current = current[token];
                } else {
                    if (typeof current[token] !== "object" || current[token] === null) {
                        current[token] = {};
                    } else {
                        current[token] = Array.isArray(current[token])
                            ? [...current[token]]
                            : { ...current[token] };
                    }
                    current = current[token];
                }
            } else {
                if (typeof token === "number") {
                    if (!Array.isArray(current)) {
                        current = [];
                    }
                    if (token >= current.length) {
                        current.length = token + 1;
                    }
                    current[token] = newValue;
                } else {
                    if (typeof current !== "object" || current === null || Array.isArray(current)) {
                        current = {};
                    }
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
    
    function getRow(cellTxt){
        if (getCellID(cellTxt)){
            return cellTxt.slice(0, 3);
        } else {
            return undefined;
        }
    }
    
    function resolveRow(row){
        let arr = [];
        for (let x = 0; x < row.length; x++){
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
            return matrix[rowIndex] || [];
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
                if (col == 0){
                    rowLog += '"' + matrix[row][col] + '"';
                } else {
                    rowLog += ', "' + matrix[row][col] + '"';
                }
            }
            rowLog += ']';
            console.log(rowLog);
        }
    }
    
    function parseFunction(row, startIndex) {
      const functionName = resolveCell(row[startIndex]);
      let funcObj = {};
      funcObj["AA"] = functionName;
      let argIndex = 0;
      let i = startIndex + 1;
      while (i < row.length && row[i] !== "|||") {
        let token 
        if (isCellRefString(row[i])){
            token = row[i].toUpperCase();
        } else {
            token = resolveCell(row[i]);
        }
        
        if (token in keywords) {
          const nestedParse = parseFunction(row, i);
          argIndex++;
          const argKey = getColumnLabel(argIndex);
          funcObj[argKey] = nestedParse.nestedObj;
          /*const argKey = String.fromCharCode(65 + argIndex);
          funcObj["A" + argKey] = nestedParse.nestedObj; // There is likely an issue fixing "A" as the only functionObj, what if it is "B" (the 27th - 43rd column), or other?*/
          i = nestedParse.newIndex;
        } else {
          argIndex++;
          const argKey = getColumnLabel(argIndex);
          funcObj[argKey] = token;
          /*const argKey = String.fromCharCode(65 + argIndex);
          funcObj["A" + argKey] = token; // There is likely an issue fixing "A" as the only functionObj, what if it is "B" (the 27th - 43rd column), or other?*/
          i++;
        }
      }
    
      const endIndex = i;
    
      let functionArray = [ functionName ];
      const objKeysSorted = Object.keys(funcObj).sort(); 
      for (let k of objKeysSorted) {
        if (k === "AA" || k === "RESULTS") continue;
        const val = funcObj[k];
        if (val && typeof val === "object" && val.RESULTS !== undefined) {
          functionArray.push(val.RESULTS);
        } else {
          functionArray.push(val);
        }
      }
    
      let expandedArray = [];
      for (let item of functionArray) {
        if (item && typeof item === "object" && Array.isArray(item.__useArray)) {
          expandedArray.push(...item.__useArray);
        } else {
          expandedArray.push(item);
        }
      }
      functionArray = expandedArray;
    
      let result;
      try {
        result = keywords[functionName](functionArray);
      } catch (err) {
        console.error("Error executing function:", functionName, err);
        result = "";
      }
    
      funcObj["RESULTS"] = result;
    
      if (endIndex < row.length && row[endIndex] === "|||") {
        i++;
      }
    
      return {
        nestedObj: funcObj,
        newIndex: i
      };
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
        } 
        else {
          if (
            Array.isArray(resolved) && 
            resolved.length > 0 && 
            typeof resolved[0] === "string" && 
            resolved[0] in keywords && resolved[0] != ""
          ) {
            const subParsed = parseNestedKeywords(resolved);
            topLevelFunctions.push(subParsed);
          } else {}
          i++;
        }
      }
    
      if (topLevelFunctions.length === 1) {
        return topLevelFunctions[0];
      } 
      else {
        return {
          type: "MULTIPLE_FUNCTIONS",
          list: topLevelFunctions
        };
      }
    }
    
    async function run() {
      rowResult = [];
      resRow = 0;
      let sweep = 0
      async function loopRows(){
        const rowArray = matrix[resRow];
        if (!Array.isArray(rowArray)) {
            rowArray = rowArray.match(/.{1,5}/g);
        }
        let parsedObject = parseNestedKeywords(rowArray);
    
        if (parsedObject.type === "MULTIPLE_FUNCTIONS") {
    
          if (parsedObject.list.length > 0) {
            rowResult[resRow] = parsedObject.list[0].RESULTS;
          } else {
            rowResult[resRow] = resolveCell(rowArray[0]);
          }
        } else {
    
            if (parsedObject.RESULTS !== undefined && parsedObject.RESULTS !== null){
                rowResult[resRow] = parsedObject.RESULTS
            }
        }
        resRow++;
        if (resRow < matrix.length) {
            loopRows()
        } else if (sweep < 1){
            resRow = 0;
            sweep++
            loopRows()
        }
      }
      loopRows();
    
    
      for (let row = 0; row < rowResult.length; row++) {
        //console.log(rowID[row], matrix[row], rowResult[row]);
      }
    }

    async function processArray(arr){
        console.log("arr",arr)
        for (a=0; a<arr.length;a++){
            if (!Array.isArray(arr[a])) {
                let rowArray = arr[a].match(/.{1,5}/g);
                await addRow(rowArray);
            } else {
                await addRow(arr[a]);
            }
        }

        //await displayTable();
        await run();
        let lastRow = rowResult[rowResult.length - 1]
        return lastRow
        //console.log("\nFinal rowResult:\n", JSON.stringify(rowResult, null, 2), "\n\n\n");
        //console.log(JSON.stringify(lastRow))
        //console.log("\n\n\n")
    }
    console.log("shorthandArray",shorthandArray)
    let v = await processArray(shorthandArray)
    return v
}


module.exports = {
    shorthand
};