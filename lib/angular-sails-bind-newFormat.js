/*! angular-sails-bind - v1.0.5 - 2015-05-05
* https://github.com/diegopamio/angular-sails-bind
* Copyright (c) 2015 Diego Pamio; Licensed MIT */
/*! angular-sails-bind - v1.0.5 - 2014-05-20
 * https://github.com/diegopamio/angular-sails-bind
 * Copyright (c) 2014 Diego Pamio; Licensed MIT */
/*global angular:false */
/*global io:false */

/**
 * Angular service to handle SailsJs resources.
 *
 * @author Diego Pamio - Github: diegopamio

 * @return {object} Object of methods
 */
try{ // This is so that angular-sails-bind works well with the module angular-sails.
    angular.module('ngSails');
    angular.module('ngSailsBind', ['ngSails']);
}catch(e){
    angular.module('ngSailsBind', []).factory('$sails', function(){
        return io.socket;
    });
}

angular.module('ngSailsBind').factory('$sailsBind', [
    '$q', '$rootScope', '$timeout', '$log', '$sails',
    function ($q, $rootScope, $timeout, $log, $sails) {
        'use strict';

        function getBindOptions(options, $scope, subset){
            if(angular.isObject(options)){
                if(!options.hasOwnProperty('scopeProperty')){
                    scopeProperty = resourceName.model.split('/').pop() + 's';
                }
                if((!options.hasOwnProperty('scope'))  && ($scope !== undefined)){
                    options.scope = $scope;
                }
                if((!options.hasOwnProperty('query'))  && (subset !== undefined)){
                    subset = options.query;
                }
            }else{
                options = {
                    model: options,
                    scopeProperty: options.split('/').pop() + 's',
                    scope: $scope
                };
                if(subset !== undefined){
                    options.query = subset;
                }
            }

            options.prefix = options.model.split('/');
            if(options.length>1) {
                options.model = options.prefix.splice(options.prefix.length - 1, 1);
                options.prefix = prefix.join('/') + '/';
            }else{
                options.prefix = '';
            }

            return options;
        }

        /**
         * This function basically does three things:
         *  1. Creates an array inside $scope and fills it with a socket get call to backend pointed by the
         *     resourceName endpoint.
         *  2. Setup the socket's incoming messages (created, updated and destroyed) to update the model.
         *  3. Setup watchers to the model to persist the changes via socket to the backend.
         *
         * @param {string|object} resourceName          Either an object defining the bind requirements or the name of the resource in
         *                                              the backend to bind, can have prefix route.
         * @param {string} resourceName.module          The sails model to bind to.
         * @param {Object} [resourceName.scopeProperty] The property within scope to use (can be sub-property - use dots to declare
         *                                              specific sub-property).
         * @param {Object} [resourceName.query]         The database query to use (will override the subset parameter).
         * @param {Object} [resourceName.scope]         The scope object to use (will override the $scope parameter).
         * @param {Object} [$scope]                     The scope where to attach the bounded model.
         * @param {Object} [subset]                     The query parameters where you can filter and sort your initial model fill.
         *                                              check http://beta.sailsjs.org/#!documentation/reference/Blueprints/FindRecords.html
         *                                              to see what you can send.
         */
        function bind(resourceName, $scope, subset){
            var options = getBindOptions(resourceName, $scope, subset);

            var defer_bind = new $q.defer();
            //1. Get the initial data into the newly created model.
            var requestEnded = _get('/' + options.prefix + options.model, subset);

            requestEnded.then(function (data) {
                if ( ! angular.isArray(data) ) {
                    data=[data];
                }
                setObjectProperty(options.scope, options.scopeProperty, data);
                addCollectionWatchersToSubitemsOf(
                    data, options.scope, options.model, options.prefix, options.scopeProperty
                );
                init();
                defer_bind.resolve();
            });

            //2. Hook the socket events to update the model.
            function onMessage(message) {
                var elements = getObjectProperty(options.scope, options.scopeProperty, []),
                    actions = {
                        created: function () {
                            getObjectProperty(options.scope, options.scopeProperty, []).push(message.data);
                            return true;
                        },
                        updated: function () {
                            var updatedElement = find(
                                elements,
                                function (element) {
                                    return message.id == element.id;
                                }
                            );
                            if (updatedElement) {
                                angular.extend(updatedElement, message.data);
                                return true;
                            }
                            return false;
                        },
                        destroyed: function () {
                            var deletedElement = find(
                                elements,
                                function (element) {
                                    return message.id == element.id;
                                }
                            );
                            if (deletedElement) {
                                elements.splice(elements.indexOf(deletedElement), 1);
                                return true;
                            }
                            return false;
                        }
                    };
                if (actions[message.verb]) {
                    if (actions[message.verb]())
                        $timeout(function(){ options.scope.$apply(); });
                } else {
                    $log.log('Unknown action »'+message.verb+'«');
                }
            }
            $sails.on(options.model, onMessage);
            options.scope.$on(options.model, function (event, message) {
                if (options.scope.$id!=message.scope)
                    onMessage(message);
            });

            //3. Watch the model for changes and send them to the backend using socket.
            function init() {
                options.scope.$watchCollection(options.scopeProperty, function (newValues, oldValues) {
                    var addedElements, removedElements;
                    newValues = newValues || [];
                    oldValues = oldValues || [];
                    addedElements =  diff(newValues, oldValues);
                    removedElements = diff(oldValues, newValues);

                    removedElements.forEach(function (item) {
                        _get('/' + options.prefix + options.model + '?id=' + item.id ).then(function (itemIsOnBackend) {
                            if (itemIsOnBackend && !itemIsOnBackend.error) {
                                $rootScope.$broadcast(options.model, { id: item.id, verb: 'destroyed', scope: options.scope.$id });
                                $sails.delete('/' + options.prefix + options.model + '/destroy/' + item.id);
                            }
                        });
                    });

                    addedElements.forEach(function (item) {
                        if (!item.id) { //if is a brand new item w/o id from the database
                            $sails.put('/' + options.prefix + options.model + '/create/', item, function (data) {
                                _get('/' + options.prefix + options.model + '/' + data.id ).then(function (newData) {
                                    angular.extend(item, newData);
                                    $rootScope.$broadcast(options.model, { id: item.id, verb: 'created', scope: options.scope.$id, data: angular.copy(item) });
                                });
                            });
                        }

                    });

                    // Add Watchers to each added element

                    addCollectionWatchersToSubitemsOf(
                        addedElements, options.scope, options.model , options.prefix, options.scopeProperty
                    );
                });
            };

            return defer_bind.promise;
        };

        /**
         * Adds watchers to each item in the model to perform the "post" when something there changes.
         * @param {string} model            The model to watch.
         * @param {object} scope            The scope where the model belongs to.
         * @param {string} resourceName     The "singular" version of the model as used by sailsjs.
         * @param {string} prefix           The api prefix to use.
         * @param {string} scopeProperty    The scope property to bind to
         */
        function addCollectionWatchersToSubitemsOf(model, scope, resourceName, prefix, scopeProperty) {
            model.forEach(function (item) {
                scope.$watchCollection(
                    scopeProperty + '[' + getObjectProperty(scope, scopeProperty, []).indexOf(item) + ']',
                    function (newValue, oldValue) {

                        if (oldValue && newValue) {
                            if (!angular.equals(oldValue, newValue) && // is in the database and is not new
                                oldValue.id == newValue.id && //not a shift
                                oldValue.updatedAt === newValue.updatedAt) { //is not an update FROM backend
                                $rootScope.$broadcast(resourceName, { id: oldValue.id, verb: 'updated', scope: scope.$id, data: angular.extend(angular.copy(newValue),{ updatedAt: (new Date()).toISOString() }) });
                                $sails.post('/' + prefix  + resourceName + '/update/' + oldValue.id,
                                    angular.copy(newValue));
                            }
                        }
                    }
                );
            });
        };

        /**
         * Internal "get" function inherited. it does the standard request, but it also returns a promise instead
         * of calling the callback.
         *
         * @private
         * @param {string} url              Url of the request.
         * @param {object} additional       Extra info (usually a query restriction)
         * @returns {Deferred.promise|*}
         */
        function _get(url, additional) {
            var defer = new $q.defer();
            additional  = additional || {};

            $sails.get(url, additional, function (res) {
                $rootScope.$apply(defer.resolve(res));
            });
            return defer.promise;
        };

        /*
         * Is the factory being executed with a Unit Test?  Useful for exporting private methods for testing.
         *
         * @private
         * @return {boolean}
         */
        function isUnitTest(){
            return ((window.hasOwnProperty('describe')) && (window.hasOwnProperty('it')));
        }

        /*
         * Set a property within an object. Can set properties deep within objects using dot-notation.
         *
         * @private
         * @param {object} obj          Object to set property on.
         * @param {string} property     The property to set use dot-notation to specify sub-properties.
         * @param {mixed} value         The value to set property to.
         */
        function setObjectProperty(obj, property, value){
            var parts = property.split('.');
            var cObj = obj;
            var lastPart = parts.pop();
            while(parts.length){
                obj[parts[0]] = angular.isObject(obj[parts[0]]) || {};
                cObj = obj[parts.shift()];
            }
            cObj[lastPart] = value;
        }

        /*
         * Get a property value within an object.  Can retrieve from deeply within the object
         * using dot-notation.
         * 
         * @private
         * @param {object} obj              The object to a property value of.
         * @param {string} property         The property to retrieve (use dot-notation to get from
         *                                  deep within object).
         * @param {mixed} [defaultValue]    The default value to return if property not found or undefined.
         * @return {mixed}
         */
        function getObjectProperty(obj, property, defaultValue){
            property = ((angular.isArray(property))?property:property.split('.'));
            while(property.length && (obj = obj[property.shift()]));
            return ((obj === undefined)?defaultValue:obj);
        }

        /*
         * Array differencing function.
         *
         * @private
         * @param {Array} ary1  The array to compare against.
         * @param {Array} ary2  The array to compare with.
         * @return {Array}
         */
        function diff(ary1, ary2) {
            return ary1.filter(function (i) {
                return ary2.indexOf(i) < 0;
            });
        }

        /*
         * ES6 Array method (Array.prototype.find()).  Returns a value in the array, if an element in the
         * array satisfies the provided testing function. Otherwise undefined is returned.
         * 
         * @private
         * @param {Array} ary           The array to use.
         * @param {function} predicate  The testing function.
         * @param {Object} [thisArg]    The context to use.
         * @returns {mixed|undefined}
         */
        function find(ary, predicate, thisArg){
            if (typeof predicate !== 'function') {
                throw new TypeError('predicate must be a function');
            }
            var list = Object(ary);
            var length = list.length >>> 0;
            var value;

            for (var i = 0; i < length; i++) {
                value = list[i];
                if (predicate.call(thisArg, value, i, list)) {
                    return value;
                }
            }
            return undefined;
        }

        var angularSailsBind = {
            bind: bind
        };

        if(isUnitTest()){
            angularSailsBind['setObjectProperty'] = setObjectProperty;
            angularSailsBind['getObjectProperty'] = getObjectProperty;
        }

        return angularSailsBind;
    }
]);