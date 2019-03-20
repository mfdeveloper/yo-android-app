const Generator = require('yeoman-generator');
const xml2json = require('xml2json');
const android = require('android-versions');

module.exports = class extends Generator {

    constructor(args, opts) {

        // Calling the super constructor is important so our generator is correctly set up
        super(args, opts);

        this.option('exclude-dependencies', {
            alias: 'deps',
            type: Boolean,
            description: 'Exclude default dependencies into build.gradle of library module'
        });

        // Is a Cordova Plugin ?
        this.prepareCordovaLib();
    }

    async prompting() {

        this.answers = await this.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'Name of your library',
                default: 'Lib'
            },
            {
                type: 'input',
                name: 'package',
                message: 'Package name for your library',
                default: (answers) => this.package ? `${this.package}.${answers.name.toLowerCase()}` : 'com.example.app'

            },
            {
                type: 'list',
                name: 'lang',
                message: 'Java or Kotlin?',
                choices: [
                    {
                        name: 'Java',
                        value: 'java'
                    }
                ]
            },
            {
                type: 'list',
                name: 'minSdkVersion',
                message: 'Minimum Android SDK',
                default: () => this.getAndroidVersions().findIndex(version => version.value == 19),
                choices: () => this.getAndroidVersions()
            },
            {
                type: 'list',
                name: 'targetSdkVersion',
                message: 'Target Android SDK',
                default: () => {

                    const result = this.getAndroidVersions();
                    return result.length - 1;
                },
                choices: () => {
                    return this.getAndroidVersions()
                }
            }
        ]);

        this.answers.module = this.answers.name.toLowerCase();
    }

    writing() {

        const rootGradleSettings = this.destinationPath('android/settings.gradle');

        var tplValues = {
            package: this.answers.package,
            name: this.answers.name,
            module: this.answers.module,
            minSdkVersion: this.answers.minSdkVersion,
            targetSdkVersion: this.answers.targetSdkVersion,
            lang: this.answers.lang,
            dependencies: ''
        };

        if (!this.options.excludeDependencies) {
            this.dependencies.forEach(dep => tplValues.dependencies += `implementation '${dep.value}'\n\t`)
        }

        this.fs.copyTpl(
            this.templatePath(`${this.answers.lang}`),
            this.destinationPath(`android/${this.answers.module}`),
            tplValues
        );

        if (this.fs.exists(rootGradleSettings)) {
            var mainGradle = this.fs.read(rootGradleSettings);
            mainGradle += `, :'${this.answers.module}'`;

            this.fs.write(rootGradleSettings, mainGradle);
        }
    }

    prepareCordovaLib() {

        if (this.fs.exists(this.destinationPath('plugin.xml'))) {
            var xml = this.fs.read(this.destinationPath('plugin.xml'));
            if (xml) {
                const jsonData = xml2json.toJson(xml, { object: true });
                if (jsonData && jsonData.plugin) {
                    const platform = jsonData.plugin.platform.find(p => p.name == 'android');
                    if (platform) {
                        this.dependencies = [
                            {
                                name: 'cordova-android',
                                value: 'com.github.mfdeveloper:cordova-android:7.1.1'
                            }
                        ];
                        this.packagePath = platform['source-file']['target-dir'].replace('src/', '');
                        this.package = this.packagePath.replace(/\//g, '\.');
                    }
                }
            }
        }
    }

    getAndroidVersions() {
        // API 15: Android 4.4 (JellyBean)
        this.androidListVersions = this.androidListVersions || android.getAll((version) => {
            return version.api >= 14
        }).map(version => {
            return {
                name: `API ${version.api}: Android ${version.semver} (${version.name})`,
                value: version.api
            }
        });

        return this.androidListVersions;
    }
}
