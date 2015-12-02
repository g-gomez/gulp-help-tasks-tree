
var _       = require('lodash');
var esprima = require('esprima');
var through = require('through2');
var chalk   = require('chalk');

module.exports = function (opts) {

    opts = opts || {};
    var tasksObj = {};
    var tasks = opts.tasks ? _.map(opts.tasks, 'name') : [];
    var description = opts.description ? opts.description : {};

    var findTasks = function (expressions, subtasks) {
        expressions = (!_.isArray(expressions)) ? [expressions] : expressions;

        _.each(expressions, function (expression) {
            if (expression.type === 'Literal' && tasks.indexOf(expression.value) >= 0) {
                subtasks[expression.value] = {};
            } else if (expression.type === 'CallExpression' &&
                    expression.callee && expression.callee.object && expression.callee.property &&
                    expression.callee.object.name === 'gulp' && expression.callee.property.name === 'task') {
                tasksObj[expression.arguments[0].value] = findTasks(expression.arguments.slice(1), {});
            } else {
                _.each(expression, function (statement) {
                    if (_.isArray(statement) || _.isObject(statement)) {
                        findTasks(statement, subtasks);
                    }
                });
            }
        });

        return subtasks;
    };

    var parseFile = function (file, enc, cb) {
        var fileDefinition = esprima.parse(file.contents.toString());
        _.each(fileDefinition, findTasks);
        cb();
    };

    var fillDependencies = function (obj) {
        _.each(obj, function (deps, name) {
            obj[name] = fillDependencies(tasksObj[name]);
        });
        return obj;
    };

    var countTasks = function (obj, task) {
        return _.reduce(obj, function (count, deps, name) {
            return (name === task) ? ++count : count + countTasks(deps, task);
        }, 0);
    };

    var removeSubtasksFromMainTasks = function (obj) {
        _.each(obj, function (deps, name) {
            if (countTasks(obj, name) > 1) {
                delete obj[name];
            }
        });
    };

    var getPrintableTasksTable = function (obj, prefix, defaultTask) {
        var lines = [];
        var nextPrefix = prefix.replace('  ├── ', '  |  ') + '  ├── ';

        _.each(obj, function (deps, name) {
            if (name === 'default') {
                lines = lines.concat(getPrintableTasksTable(deps, '', true));
                return;
            }

            var taskName = name;
            var taskDescription = description[name] ? _.capitalize(description[name]) : '';

            if (!prefix) {
                lines.push('');
                taskName = chalk.bold(taskName);
                taskName = defaultTask ? chalk.magenta(taskName + ' (default task)') : chalk.cyan(taskName);
                taskDescription = chalk.bold(defaultTask ? chalk.magenta(taskDescription) : chalk.cyan(taskDescription));
            }

            if (_.findLastKey(obj) === name) {
                prefix = prefix.replace('├', '└');
                var countPipe = (nextPrefix.match(/\|/g) || []).length;
                nextPrefix = nextPrefix.replace(/\|/g, function (match) {
                    return (--countPipe === 0) ? ' ' : match;
                });
            }

            lines.push([' ' + chalk.gray(prefix) + taskName, taskDescription]);
            lines = lines.concat(getPrintableTasksTable(deps, nextPrefix));
        });
        return lines;
    };

    var getPrintableOptionsTable = function (options) {
        var lines = [];
        _.each(options, function (option) {
            lines.push('');
            var taskName = chalk.bold('  --' + chalk.magenta(option.name));
            if (option.alias) {
                taskName += ' or (' + chalk.magenta(option.alias) + ')';
            }
            if (option.type) {
                var type = _.isArray(option.type) ? option.type.join('|') : option.type;
                taskName += '  [' + type + ']';
            }
            lines.push([taskName, option.description ? option.description : '']);

            if (option.tasks) {
                var tasks = _.isArray(option.tasks) ? option.tasks.join(', ') : option.tasks;
                lines.push(chalk.gray('    Tasks: ' + tasks));
            }
            if (option.values) {
                var values = _.isArray(option.values) ? option.values.join(', ') : option.values;
                lines.push(chalk.gray('    Possible values: ' + values));
            }
            if (option.default) {
                lines.push(chalk.gray('    Default value: ' + option.default));
            }
        });
        return lines;
    };

    var getMargin = function (table) {
        var longerLine = _.max(table, function (line) {
            return _.isArray(line) ? chalk.stripColor(line[0]).length : 0;
        });
        return chalk.stripColor(longerLine[0]).length + 5;
    };

    var printTable = function (table, margin) {
        _.each(table, function (line) {
            var print = _.isArray(line) ? line[0] + _.repeat(' ', margin - chalk.stripColor(line[0]).length) + line[1] : line;
            console.log(!chalk.supportsColor ? chalk.stripColor(print) : print);
        });
    };

    var printHelp = function (cb) {
        fillDependencies(tasksObj);
        removeSubtasksFromMainTasks(tasksObj);

        var out = [];
        out.push('', chalk.underline('Usage:'), '');
        out.push('  gulp [TASKS...] [OPTIONS...]', '');
        if (opts.options) {
            out.push('', chalk.underline('Available options:'));
            out = out.concat(getPrintableOptionsTable(opts.options));
            out.push('');
        }
        out.push('', chalk.underline('Available tasks:'));
        out = out.concat(getPrintableTasksTable(tasksObj, ''));
        out.push('', '');
        printTable(out, getMargin(out));
        cb();
    };

    return through.obj(parseFile, printHelp);
};
