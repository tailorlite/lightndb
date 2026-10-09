function resolvePath(obj, path) {
  const parts = path.split('.');
  let current = [obj];

  for (const part of parts) {
    const next = [];
    for (const val of current) {
      if (val === null || val === undefined) continue;
      
      if (Array.isArray(val) && !isNaN(parseInt(part, 10))) {
        // array index access
        if (val[part] !== undefined) next.push(val[part]);
      } else if (Array.isArray(val)) {
        // map over array
        for (const item of val) {
          if (item !== null && item !== undefined && item[part] !== undefined) {
            next.push(item[part]);
          }
        }
      } else if (typeof val === 'object') {
        if (val[part] !== undefined) next.push(val[part]);
      }
    }
    current = next;
  }
  
  return current;
}

function evaluateCondition(value, condition) {
  if (condition !== null && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof RegExp)) {
    for (const [op, opVal] of Object.entries(condition)) {
      switch (op) {
        case '$eq': if (value !== opVal) return false; break;
        case '$ne': if (value === opVal) return false; break;
        case '$gt': if (!(value > opVal)) return false; break;
        case '$gte': if (!(value >= opVal)) return false; break;
        case '$lt': if (!(value < opVal)) return false; break;
        case '$lte': if (!(value <= opVal)) return false; break;
        case '$in': if (!Array.isArray(opVal) || !opVal.includes(value)) return false; break;
        case '$nin': if (Array.isArray(opVal) && opVal.includes(value)) return false; break;
        case '$exists': 
          const exists = value !== undefined;
          if (opVal ? !exists : exists) return false;
          break;
        case '$regex':
          const rx = typeof opVal === 'string' ? new RegExp(opVal) : opVal;
          if (!rx.test(String(value))) return false;
          break;
        default:
          return false;
      }
    }
    return true;
  } else if (condition instanceof RegExp) {
    return condition.test(String(value));
  } else {
    // implicit equality
    return value === condition || (Array.isArray(value) && value.includes(condition));
  }
}

function matchField(doc, path, condition) {
  const values = resolvePath(doc, path);
  
  if (condition !== null && typeof condition === 'object' && condition.$exists !== undefined) {
    const exists = values.length > 0;
    return condition.$exists ? exists : !exists;
  }

  if (values.length === 0) return false;

  for (const val of values) {
    if (evaluateCondition(val, condition)) return true;
  }
  return false;
}

function match(doc, selector) {
  for (const [key, value] of Object.entries(selector)) {
    if (key === '$and') {
      if (!Array.isArray(value) || !value.every(sub => match(doc, sub))) return false;
    } else if (key === '$or') {
      if (!Array.isArray(value) || !value.some(sub => match(doc, sub))) return false;
    } else if (key === '$not') {
      if (match(doc, value)) return false;
    } else {
      if (!matchField(doc, key, value)) return false;
    }
  }
  return true;
}

module.exports = {
  resolvePath,
  match
};
