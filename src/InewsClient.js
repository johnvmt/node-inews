import EventEmitter from "events";
import InewsConnectionClient from "./InewsConnectionClient.js";
import NestedMap from "./NestedMap.js";

class InewsClient extends EventEmitter {
	constructor(config = {}) {
		super();
		this._connectionClients = new Set();
		this._connectionClientTimeouts = new Map();
		this._pendingRequestConnectionClients = new NestedMap();

		this.config = Object.assign({
            maxConnections: 1,
			minConnections: 0,
            optimalConnectionJobs: 25,
            rotateHosts: true,
            connectionIdleTimeout: 60000, // 1 minute
			debug: false
        }, config);

		if(typeof this.config.maxConnections !== 'number' || this.config.maxConnections < 1)
		    throw new Error(`maxConnections must be larger than 1`);

        if(this.config.maxConnections < this.config.minConnections)
            throw new Error(`minConnections must be greater than or equal to maxConnections`);

        if(!Array.isArray(this.config.hosts) && typeof this.config.host === 'string')
            this.config.hosts = [this.config.host];

        if(!Array.isArray(this.config.hosts) || this.config.hosts.length === 0)
            throw new Error(`Missing hosts option`);
        if(!this.config.hasOwnProperty('user'))
            throw new Error(`Missing user option`);
        if(!this.config.hasOwnProperty('password'))
            throw new Error(`Missing password option`);
	}

	get connections() {
		return this._connectionClients.size;
	}

	get load() {
		return this.requests / (this.config.maxConnections * this.config.optimalConnectionJobs);
	}

	get requests() {
		let requests = 0;
		for(let connectionClient of this._connectionClients)
			requests += connectionClient.requests;
		return requests;
	}

	get queued() {
		let queued = 0;
		for(let connectionClient of this._connectionClients)
			queued += connectionClient.queued;
		return queued;
	}

	get running() {
		let running = 0;
		for(let connectionClient of this._connectionClients)
			running += connectionClient.running;
		return running;
	}

	list(directory) {
		const self = this;
		const requestPath = ['list', directory];

		if(self._pendingRequestConnectionClients.has(requestPath))
			return self._pendingRequestConnectionClients.get(requestPath).list(directory);
		else {
			const connectionClient = self._optimalConnectionClient(directory);
			self._pendingRequestConnectionClients.set(requestPath, connectionClient);
			return connectionClient.list(directory).finally(() => {
				self._pendingRequestConnectionClients.delete(requestPath);
			});
		}
	}

	story(directory, file) {
		const self = this;
		const requestPath = ['story', directory, file];

		if(self._pendingRequestConnectionClients.has(requestPath))
			return self._pendingRequestConnectionClients.get(requestPath).story(directory, file);
		else {
			const connectionClient = self._optimalConnectionClient(directory);
			self._pendingRequestConnectionClients.set(requestPath, connectionClient);
			return connectionClient.story(directory, file).finally(() => {
				self._pendingRequestConnectionClients.delete(requestPath);
			});
		}
	}

	storyNsml(directory, file) {
		const self = this;
		const requestPath = ['story', directory, file];

		if(self._pendingRequestConnectionClients.has(requestPath))
			return self._pendingRequestConnectionClients.get(requestPath).storyNsml(directory, file);
		else {
			const connectionClient = self._optimalConnectionClient(directory);
			self._pendingRequestConnectionClients.set(requestPath, connectionClient);
			return connectionClient.storyNsml(directory, file).finally(() => {
				self._pendingRequestConnectionClients.delete(requestPath);
			});
		}
	}

	_optimalConnectionClient(directory) {
		/*
		Sort by number of jobs running decreasing
		Priority order:
		- Connection with directory as its last request where # of jobs < optimalConnectionJobs
		- Any connection where # of jobs < optimalConnectionJobs
		- New connection, if possible
		- Connection with directory as its last request whose load factor rounds to system load factor
		- Connection with least number of jobs
		 */

		let connectionClients = Array.from(this._connectionClients);

		connectionClients.sort((connectionClient1, connectionClient2) => {
			if(connectionClient1.requests > connectionClient2.requests)
				return -1;
			else if(connectionClient1.requests < connectionClient2.requests)
				return 1;
			return 0;
		});

		for(let connectionClient of connectionClients) {
			if(connectionClient.lastDirectory === directory && connectionClient.requests < this.config.optimalConnectionJobs)
				return connectionClient;
		}

		for(let connectionClient of connectionClients) {
			if(connectionClient.requests < this.config.optimalConnectionJobs)
				return connectionClient;
		}

		if(this.connections < this.config.maxConnections)
			return this._addConnectionClient();

		const totalLoad = this.load;
		for(let connectionClient of connectionClients) {
			const connectionLoad = connectionClient.requests / this.config.optimalConnectionJobs;
			if(connectionClient.lastDirectory === directory && Math.floor(connectionLoad) <= Math.floor(totalLoad))
				return connectionClient;
		}

		return connectionClients[(connectionClients.length - 1)]; // connection with fewest requests, from sorted list
    }

	_addConnectionClient() {
		const self = this;
	    let hosts = this.config.hosts;
        if(this.config.rotateHosts) {
            const hostStartIndex = (typeof this._hostStartIndex === 'number') ? (this._hostStartIndex + 1) % hosts.length : 0;
            hosts = hosts.slice(hostStartIndex).concat(hosts.slice(0, hostStartIndex));
            this._hostStartIndex = hostStartIndex;
        }

        const connectionClient = new InewsConnectionClient(Object.assign({}, this.config, {hosts: hosts}));

		connectionClient.on('error', (error) => {
			self.emit('error', error);
		});

		connectionClient.on('queued', (queued) => {
			self.emit('queued', self.queued);
		});

		connectionClient.on('running', (running) => {
			self.emit('running', self.running);
		});

		connectionClient.on('requests', (requests) => {
			self.emit('requests', self.requests);

			if(requests > 0)
				self._deleteConnectionClientTimeout(connectionClient);
			else
				self._resetConnectionClientTimeout(connectionClient);
		});

		self._connectionClients.add(connectionClient);

		self.emit('connections', self.connections);

		return connectionClient;
    }

    async _deleteConnectionClient(connectionClient) {
		if(this._connectionClients.has(connectionClient) && (this.connections - 1) >= this.config.minConnections) {
			this._connectionClients.delete(connectionClient);
			await connectionClient.destroy();
			this.emit('connections', this.connections);
			this._debug(`Deleting connectionClient`)
		}
    }

	_deleteConnectionClientTimeout(connectionClient) {
		if(this._connectionClientTimeouts.has(connectionClient)) {
			clearTimeout(this._connectionClientTimeouts.get(connectionClient));
			this._connectionClientTimeouts.delete(connectionClient)
		}
	}

	_resetConnectionClientTimeout(connectionClient) {
		const self = this;
		self._deleteConnectionClientTimeout(connectionClient);

		if(typeof self.config.connectionIdleTimeout === 'number' && self.config.connectionIdleTimeout > 0) {
			const connectionClientTimeout = setTimeout(() => {
				self._deleteConnectionClient(connectionClient);
			}, self.config.connectionIdleTimeout);
			this._connectionClientTimeouts.set(connectionClient, connectionClientTimeout);
		}
	}

	_debug() {
		if(this.config.debug)
			console.log.apply(console, [(new Date()).toISOString()].concat(Array.prototype.slice.call(arguments)));
	}

	static get FILETYPES() {
		return InewsConnectionClient.FILETYPES;
	}
}

export default InewsClient
