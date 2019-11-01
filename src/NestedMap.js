class NestedMap {
    constructor() {
        this._root = new Map();
    }

    *[Symbol.iterator]() {
        function * traverse(map, pathParts = []) {
            for(let elem of map) {
                let key = elem[0];
                if(elem[1] instanceof Map)
                    yield * traverse(map.get(key), pathParts.concat([key]));
                else
                    yield [pathParts.concat([key]), map.get(key)];
            }
        }

        yield * traverse(this._root);
    };

    get(path, valueIfUndefined = undefined) {
        function mapGet(map, path, valueIfUndefined) {
            const pathParts = Array.isArray(path) ? path : path.split('.');
            if(!(map instanceof Map))
                return valueIfUndefined;
            else if(pathParts.length === 1) {
                return map.has(pathParts[0]) ? map.get(pathParts[0]) : valueIfUndefined;
            }
            else
                return mapGet(map.get(pathParts[0]), pathParts.slice(1), valueIfUndefined);
        }

        return mapGet(this._root, path, valueIfUndefined);
    }

    set(path, value) {
        function mapSet(map, path, value) {
            const pathParts = Array.isArray(path) ? path : path.split('.');
            const key = pathParts[0];
            if(pathParts.length === 1)
                map.set(key, value);
            else {
                if(!(map.get(key) instanceof Map))
                    map.set(key, new Map());
                mapSet(map.get(key), pathParts.slice(1), value);
            }
        }

        return mapSet(this._root, path, value);
    }

    has(path) {
        function mapHas(map, path) {
            const pathParts = Array.isArray(path) ? path : path.split('.');
            if(!(map instanceof Map))
                return false;
            else if(pathParts.length === 1)
                return map.has(pathParts[0]);
            else
                return mapHas(map.get(pathParts[0]), pathParts.slice(1));
        }

        return mapHas(this._root, path);
    }

    delete(path, cleanTree = true) {
        function mapDelete(map, path, cleanTree) {
            const pathParts = Array.isArray(path) ? path : path.split('.');
            const key = pathParts[0];
            if(pathParts.length === 1)
                map.delete(key);
            else if(map.get(key) instanceof Map) {
                mapDelete(map.get(key), pathParts.slice(1));
                if(cleanTree && map.get(key).size === 0)
                    map.delete(key);
            }
        }

        return mapDelete(this._root, path, cleanTree);
    }
}

export default NestedMap;
